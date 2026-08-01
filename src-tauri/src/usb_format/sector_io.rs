//! Adaptateur qui n'émet vers le support QUE des lectures et écritures alignées sur le secteur.
//!
//! Un handle de volume Windows (`\\.\I:`) n'accepte pas une écriture de 3 octets à l'offset 517 :
//! il veut des multiples entiers de la taille de secteur, à des offsets multiples de celle-ci.
//! `fatfs`, lui, écrit comme dans un fichier — quelques octets ici, un en-tête là.
//!
//! Cet adaptateur fait le pont : il garde un secteur en mémoire, applique dessus les écritures
//! partielles, et ne pousse vers le support qu'un secteur complet. Une écriture qui commence au
//! milieu d'un secteur relit d'abord ce secteur (lecture-modification-écriture), sinon les octets
//! voisins seraient écrasés par du vide.
//!
//! **Ce n'était pas une optimisation.** Le premier formatage réel a échoué ici, sur un disque de
//! 500 Go : partition créée, FAT jamais écrite, volume laissé RAW. C'était l'hypothèse que j'avais
//! notée sans la vérifier — « l'alignement n'est exigé que pour `FILE_FLAG_NO_BUFFERING` » — et
//! elle était fausse pour ce chemin.

use std::io::{Read, Result as IoResult, Seek, SeekFrom, Write};

/// Support tamponné, aligné sur `sector` octets.
pub struct SectorIo<T: Read + Write + Seek> {
    inner: T,
    sector: u64,
    /// Le secteur actuellement en mémoire, et son index. `None` = rien de chargé.
    buf: Vec<u8>,
    loaded: Option<u64>,
    dirty: bool,
    /// Position logique vue par l'appelant, en octets depuis le début du volume.
    pos: u64,
}

impl<T: Read + Write + Seek> SectorIo<T> {
    pub fn new(inner: T, sector: u64) -> Self {
        SectorIo {
            inner,
            sector,
            buf: vec![0u8; sector as usize],
            loaded: None,
            dirty: false,
            pos: 0,
        }
    }

    /// Charge le secteur `index` en mémoire, après avoir écrit le précédent s'il était sali.
    fn load(&mut self, index: u64) -> IoResult<()> {
        if self.loaded == Some(index) {
            return Ok(());
        }
        self.flush_buf()?;
        self.inner.seek(SeekFrom::Start(index * self.sector))?;
        // Un secteur au-delà de la fin du support lit court : on complète de zéros plutôt que
        // d'échouer, parce qu'écrire le tout premier secteur d'un volume vierge commence
        // forcément par une lecture de ce qui n'existe pas encore.
        let mut read = 0usize;
        while read < self.buf.len() {
            match self.inner.read(&mut self.buf[read..]) {
                Ok(0) => break,
                Ok(n) => read += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
        self.buf[read..].fill(0);
        self.loaded = Some(index);
        self.dirty = false;
        Ok(())
    }

    /// Pousse le secteur en mémoire vers le support, s'il a été modifié.
    fn flush_buf(&mut self) -> IoResult<()> {
        if !self.dirty {
            return Ok(());
        }
        if let Some(index) = self.loaded {
            self.inner.seek(SeekFrom::Start(index * self.sector))?;
            self.inner.write_all(&self.buf)?;
        }
        self.dirty = false;
        Ok(())
    }
}

impl<T: Read + Write + Seek> Read for SectorIo<T> {
    fn read(&mut self, out: &mut [u8]) -> IoResult<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let index = self.pos / self.sector;
        let offset = (self.pos % self.sector) as usize;
        self.load(index)?;
        let n = out.len().min(self.sector as usize - offset);
        out[..n].copy_from_slice(&self.buf[offset..offset + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl<T: Read + Write + Seek> Write for SectorIo<T> {
    fn write(&mut self, data: &[u8]) -> IoResult<usize> {
        if data.is_empty() {
            return Ok(0);
        }
        let index = self.pos / self.sector;
        let offset = (self.pos % self.sector) as usize;
        self.load(index)?;
        let n = data.len().min(self.sector as usize - offset);
        self.buf[offset..offset + n].copy_from_slice(&data[..n]);
        self.dirty = true;
        self.pos += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> IoResult<()> {
        self.flush_buf()?;
        self.inner.flush()
    }
}

impl<T: Read + Write + Seek> Seek for SectorIo<T> {
    fn seek(&mut self, from: SeekFrom) -> IoResult<u64> {
        self.pos = match from {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(d) => self.pos.saturating_add_signed(d),
            // `End` demanderait la taille du support ; `write_fat32` passe `total_sectors`
            // explicitement pour ne jamais avoir besoin de la chercher.
            SeekFrom::End(d) => {
                let end = self.inner.seek(SeekFrom::End(0))?;
                end.saturating_add_signed(d)
            }
        };
        Ok(self.pos)
    }
}

impl<T: Read + Write + Seek> Drop for SectorIo<T> {
    fn drop(&mut self) {
        // Sans ça, le dernier secteur écrit resterait en mémoire et le système de fichiers serait
        // tronqué de 512 octets — assez pour qu'il ne monte pas.
        let _ = self.flush_buf();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Toute E/S poussee vers le support doit etre alignee : c'est la seule raison d'etre de ce
    /// type. Un support espion enregistre chaque appel et refuse ce qui ne l'est pas.
    struct AlignedOnly {
        data: Vec<u8>,
        pos: u64,
        sector: u64,
        violations: std::rc::Rc<std::cell::RefCell<Vec<String>>>,
    }

    impl Read for AlignedOnly {
        fn read(&mut self, out: &mut [u8]) -> IoResult<usize> {
            if self.pos % self.sector != 0 || out.len() as u64 % self.sector != 0 {
                self.violations
                    .borrow_mut()
                    .push(format!("lecture {} @ {}", out.len(), self.pos));
            }
            let start = self.pos as usize;
            if start >= self.data.len() {
                return Ok(0);
            }
            let n = out.len().min(self.data.len() - start);
            out[..n].copy_from_slice(&self.data[start..start + n]);
            self.pos += n as u64;
            Ok(n)
        }
    }

    impl Write for AlignedOnly {
        fn write(&mut self, data: &[u8]) -> IoResult<usize> {
            if self.pos % self.sector != 0 || data.len() as u64 % self.sector != 0 {
                self.violations.borrow_mut().push(format!(
                    "ecriture {} @ {}",
                    data.len(),
                    self.pos
                ));
            }
            let start = self.pos as usize;
            if self.data.len() < start + data.len() {
                self.data.resize(start + data.len(), 0);
            }
            self.data[start..start + data.len()].copy_from_slice(data);
            self.pos += data.len() as u64;
            Ok(data.len())
        }
        fn flush(&mut self) -> IoResult<()> {
            Ok(())
        }
    }

    impl Seek for AlignedOnly {
        fn seek(&mut self, from: SeekFrom) -> IoResult<u64> {
            self.pos = match from {
                SeekFrom::Start(n) => n,
                SeekFrom::Current(d) => self.pos.saturating_add_signed(d),
                SeekFrom::End(d) => (self.data.len() as u64).saturating_add_signed(d),
            };
            Ok(self.pos)
        }
    }

    /// LE test : des ecritures minuscules et desalignees ne doivent produire QUE des E/S alignees.
    /// C'est ce qui manquait au premier formatage reel, qui a laisse un disque RAW.
    #[test]
    fn unaligned_writes_reach_the_device_aligned() {
        let violations = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let spy = AlignedOnly {
            data: vec![0u8; 4096],
            pos: 0,
            sector: 512,
            violations: violations.clone(),
        };
        let mut io = SectorIo::new(spy, 512);
        io.seek(SeekFrom::Start(3)).expect("seek");
        io.write_all(b"abc").expect("write");
        io.seek(SeekFrom::Start(517)).expect("seek");
        io.write_all(b"defgh").expect("write");
        io.flush().expect("flush");
        drop(io);
        assert!(
            violations.borrow().is_empty(),
            "E/S non alignees: {:?}",
            violations.borrow()
        );
    }

    /// Une ecriture partielle ne doit PAS effacer les octets voisins du meme secteur : sans
    /// lecture-modification-ecriture, chaque petite ecriture zapperait 511 octets autour d'elle.
    #[test]
    fn a_partial_write_preserves_its_neighbours() {
        let mut backing = Cursor::new(vec![0xAAu8; 1024]);
        {
            let mut io = SectorIo::new(&mut backing, 512);
            io.seek(SeekFrom::Start(10)).expect("seek");
            io.write_all(b"XY").expect("write");
            io.flush().expect("flush");
        }
        let out = backing.into_inner();
        assert_eq!(&out[8..14], &[0xAA, 0xAA, b'X', b'Y', 0xAA, 0xAA]);
    }

    #[test]
    fn writes_then_reads_round_trip_across_sectors() {
        let mut backing = Cursor::new(vec![0u8; 4096]);
        let payload: Vec<u8> = (0..1500u32).map(|i| (i % 251) as u8).collect();
        {
            let mut io = SectorIo::new(&mut backing, 512);
            io.seek(SeekFrom::Start(300)).expect("seek");
            io.write_all(&payload).expect("write");
            io.flush().expect("flush");
        }
        let mut io = SectorIo::new(&mut backing, 512);
        io.seek(SeekFrom::Start(300)).expect("seek");
        let mut back = vec![0u8; payload.len()];
        io.read_exact(&mut back).expect("read");
        assert_eq!(back, payload);
    }

    /// Le dernier secteur doit partir meme sans `flush` explicite : `fatfs` rend la main sans
    /// toujours vider, et 512 octets manquants suffisent a rendre le volume non montable.
    #[test]
    fn dropping_flushes_the_last_sector() {
        let mut backing = Cursor::new(vec![0u8; 1024]);
        {
            let mut io = SectorIo::new(&mut backing, 512);
            io.seek(SeekFrom::Start(600)).expect("seek");
            io.write_all(b"Z").expect("write");
            // pas de flush : c'est le Drop qui doit s'en charger
        }
        assert_eq!(backing.into_inner()[600], b'Z');
    }
}
