#![cfg_attr(not(test), windows_subsystem = "windows")]
use std::{io, path::Path, fs};

fn remove_unchanged(target:&Path, length:u64, modified:std::time::SystemTime)->io::Result<()> {
    let metadata=fs::metadata(target)?;
    if !metadata.is_file() || metadata.len()!=length || metadata.modified()?!=modified {
        return Err(io::Error::new(io::ErrorKind::InvalidData,"Installer changed while waiting; keeping it"));
    }
    fs::remove_file(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(label:&str)->std::path::PathBuf {
        let root=std::env::current_dir().unwrap().join("src-tauri/target/installer-cleanup-tests");
        fs::create_dir_all(&root).unwrap();root.join(format!("{}-{label}.exe",std::process::id()))
    }
    #[test] fn removes_only_the_selected_unchanged_installer() {
        let target=fixture("selected");let other=fixture("other");fs::write(&target,b"test installer").unwrap();fs::write(&other,b"other file").unwrap();
        let m=fs::metadata(&target).unwrap();remove_unchanged(&target,m.len(),m.modified().unwrap()).unwrap();
        assert!(!target.exists());assert!(other.exists());fs::remove_file(other).unwrap();
    }
    #[test] fn preserves_a_file_replaced_while_waiting() {
        let target=fixture("replaced");fs::write(&target,b"original").unwrap();let m=fs::metadata(&target).unwrap();fs::write(&target,b"a different replacement").unwrap();
        assert!(remove_unchanged(&target,m.len(),m.modified().unwrap()).is_err());assert_eq!(fs::read(&target).unwrap(),b"a different replacement");fs::remove_file(target).unwrap();
    }
}

#[cfg(not(test))]
fn main() {
    use std::io::Write;
    let args:Vec<_>=std::env::args_os().skip(1).collect();
    if args.len()!=3 {std::process::exit(2);}
    let result=(||->io::Result<()> {
        let pid=args[0].to_str().and_then(|s|s.parse::<u32>().ok()).filter(|p|*p>0).ok_or_else(||io::Error::new(io::ErrorKind::InvalidInput,"Invalid installer PID"))?;
        let target=Path::new(&args[1]);
        if !target.is_absolute() || !target.extension().is_some_and(|s|s.eq_ignore_ascii_case("exe")) || target.canonicalize()?==std::env::current_exe()?.canonicalize()? {
            return Err(io::Error::new(io::ErrorKind::InvalidInput,"Only the selected installer EXE may be deleted"));
        }
        let metadata=fs::metadata(target)?;
        let (length,modified)=(metadata.len(),metadata.modified()?);
        wait_for_installer(pid,target)?;
        remove_unchanged(target,length,modified)
    })();
    if let Ok(mut log)=fs::OpenOptions::new().append(true).create(true).open(&args[2]) {let _=writeln!(log,"installer-cleanup {:?}",result);}
    std::process::exit(if result.is_ok(){0}else{1});
}

#[cfg(not(test))]
fn wait_for_installer(pid:u32,target:&Path)->io::Result<()> {
    use std::ffi::c_void;
    #[link(name="kernel32")] extern "system" {
        fn OpenProcess(access:u32,inherit:i32,pid:u32)->*mut c_void;
        fn QueryFullProcessImageNameW(process:*mut c_void,flags:u32,name:*mut u16,size:*mut u32)->i32;
        fn WaitForSingleObject(object:*mut c_void,ms:u32)->u32;
        fn CloseHandle(object:*mut c_void)->i32;
    }
    unsafe {
        let process=OpenProcess(0x00101000,0,pid);
        if process.is_null() {
            let error=io::Error::last_os_error();
            // The NSIS process may have exited before this helper starts.
            return if error.raw_os_error()==Some(87){Ok(())}else{Err(error)};
        }
        let result=(||->io::Result<()> {
            let mut name=vec![0u16;32768];let mut length=name.len() as u32;
            if QueryFullProcessImageNameW(process,0,name.as_mut_ptr(),&mut length)==0 {return Err(io::Error::last_os_error());}
            let process_path=std::path::PathBuf::from(String::from_utf16_lossy(&name[..length as usize]));
            if !process_path.canonicalize()?.to_string_lossy().eq_ignore_ascii_case(&target.canonicalize()?.to_string_lossy()) {
                return Err(io::Error::new(io::ErrorKind::InvalidInput,"Installer PID does not match the selected EXE"));
            }
            match WaitForSingleObject(process,120000) {0=>Ok(()),258=>Err(io::Error::new(io::ErrorKind::TimedOut,"Installer did not close; keeping EXE")),_=>Err(io::Error::last_os_error())}
        })();
        CloseHandle(process);result
    }
}
