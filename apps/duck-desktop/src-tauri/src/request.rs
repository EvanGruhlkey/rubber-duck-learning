use command_group::CommandGroup;
use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

pub struct RequestControl {
    cancelled: AtomicBool,
    deadline: Instant,
}

impl RequestControl {
    pub fn new(timeout: Duration) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            deadline: Instant::now() + timeout,
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err("Request stopped.".into())
        } else if Instant::now() >= self.deadline {
            Err("Request timed out. Try again or ask a shorter question.".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Default)]
pub struct Requests(Mutex<RequestState>);

#[derive(Default)]
struct RequestState {
    cancelled_through: u64,
    active: Option<(u64, Arc<RequestControl>)>,
}

impl Requests {
    pub fn start(&self, id: u64) -> Result<Arc<RequestControl>, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Restart the duck to reset request state.")?;
        if id <= state.cancelled_through {
            return Err("Request stopped.".into());
        }
        if state.active.is_some() {
            return Err("The duck is already answering. Stop that request first.".into());
        }
        let control = Arc::new(RequestControl::new(Duration::from_secs(120)));
        state.active = Some((id, Arc::clone(&control)));
        Ok(control)
    }

    pub fn cancel(&self, id: u64) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Restart the duck to reset request state.")?;
        state.cancelled_through = state.cancelled_through.max(id);
        if let Some((active_id, control)) = &state.active {
            if *active_id == id {
                control.cancel();
            }
        }
        Ok(())
    }

    pub fn finish(&self, id: u64) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "Restart the duck to reset request state.")?;
        if state
            .active
            .as_ref()
            .is_some_and(|(active_id, _)| *active_id == id)
        {
            state.active = None;
        }
        Ok(())
    }
}

fn read_pipe(mut pipe: impl Read + Send + 'static) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        pipe.read_to_end(&mut bytes)?;
        Ok(bytes)
    })
}

pub fn run_cli(
    cmd: &mut Command,
    prompt: &str,
    control: &RequestControl,
) -> Result<Output, String> {
    control.check()?;
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut group = cmd.group();
    #[cfg(windows)]
    group.creation_flags(0x0800_0000).kill_on_drop(true);
    let mut child = group.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.inner().stdin.take().expect("piped stdin");
    let stdout = read_pipe(child.inner().stdout.take().expect("piped stdout"));
    let stderr = read_pipe(child.inner().stderr.take().expect("piped stderr"));
    let prompt = prompt.to_owned();
    let input = thread::spawn(move || stdin.write_all(prompt.as_bytes()));
    let status: Result<_, String> = (|| loop {
        control.check()?;
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if input.is_finished() && stdout.is_finished() && stderr.is_finished() {
                return Ok(status);
            }
        }
        thread::sleep(Duration::from_millis(40));
    })();
    if status.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let status = status?;
    let input = input.join().map_err(|_| "Could not send the question.")?;
    if status.success() {
        input.map_err(|e| e.to_string())?;
    }
    let stdout = stdout
        .join()
        .map_err(|_| "Could not read the reply.")?
        .map_err(|e| e.to_string())?;
    let stderr = stderr
        .join()
        .map_err(|_| "Could not read CLI errors.")?
        .map_err(|e| e.to_string())?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

pub fn query_cli(
    cmd: &mut Command,
    input: &str,
    complete: impl Fn(&str) -> bool,
    control: &RequestControl,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::sync::mpsc;
    control.check()?;
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut group = cmd.group();
    #[cfg(windows)]
    group.creation_flags(0x0800_0000).kill_on_drop(true);
    let mut child = group.spawn().map_err(|error| error.to_string())?;
    let mut stdin = child.inner().stdin.take().expect("piped stdin");
    let stdout = child.inner().stdout.take().expect("piped stdout");
    let stderr = read_pipe(child.inner().stderr.take().expect("piped stderr"));
    let (send, receive) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if send.send(line).is_err() {
                break;
            }
        }
    });
    let result = (|| {
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())?;
        let mut output = String::new();
        loop {
            control.check()?;
            match receive.recv_timeout(Duration::from_millis(40)) {
                Ok(line) => {
                    let line = line.map_err(|error| error.to_string())?;
                    output.push_str(&line);
                    output.push('\n');
                    if complete(&line) {
                        return Ok(output);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("The IDE CLI closed before returning its models.".into())
                }
            }
        }
    })();
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    drop(receive);
    let _ = reader.join();
    let _ = stderr.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(script: &str) -> Command {
        #[cfg(windows)]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            let mut cmd = Command::new("powershell.exe");
            cmd.creation_flags(0x0800_0000);
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
            cmd
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", script]);
            cmd
        };
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    #[test]
    fn initialization_query_keeps_stdin_open_and_stops_after_the_response() {
        #[cfg(windows)]
        let mut cmd = shell("$line = [Console]::In.ReadLine(); [Console]::Out.WriteLine('models-ready'); [Console]::Out.Flush(); Start-Sleep -Seconds 30");
        #[cfg(not(windows))]
        let mut cmd = shell("read line; printf 'models-ready\\n'; sleep 30");
        let started = Instant::now();
        let output = query_cli(
            &mut cmd,
            "initialize\n",
            |line| line == "models-ready",
            &RequestControl::new(Duration::from_secs(5)),
        )
        .unwrap();
        assert_eq!(output, "models-ready\n");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn passes_prompt_as_literal_stdin_and_drains_both_pipes() {
        let prompt = "Explain \"quotes\", & echo nope | more > file %PATH%\nsecond line";
        #[cfg(windows)]
        let mut cmd = shell(
            "[Console]::Out.Write([Console]::In.ReadToEnd()); [Console]::Error.Write('diagnostic')",
        );
        #[cfg(not(windows))]
        let mut cmd = shell("cat; printf diagnostic >&2");
        let output = run_cli(
            &mut cmd,
            prompt,
            &RequestControl::new(Duration::from_secs(10)),
        )
        .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap(), prompt);
        assert_eq!(output.stderr, b"diagnostic");
    }

    #[test]
    fn times_out_a_real_process() {
        #[cfg(windows)]
        let mut cmd = shell("Start-Sleep -Seconds 30");
        #[cfg(not(windows))]
        let mut cmd = shell("sleep 30");
        let started = Instant::now();
        let error = run_cli(
            &mut cmd,
            "",
            &RequestControl::new(Duration::from_millis(200)),
        )
        .unwrap_err();
        assert_eq!(
            error,
            "Request timed out. Try again or ask a shorter question."
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn cancels_a_running_process_and_its_child() {
        #[cfg(windows)]
        let mut cmd =
            shell("& powershell.exe -NoProfile -NonInteractive -Command 'Start-Sleep -Seconds 30'");
        #[cfg(not(windows))]
        let mut cmd = shell("sleep 30 & wait");
        let control = Arc::new(RequestControl::new(Duration::from_secs(10)));
        let cancel = Arc::clone(&control);
        let stopper = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            cancel.cancel();
        });
        let started = Instant::now();
        let error = run_cli(&mut cmd, "", &control).unwrap_err();
        stopper.join().unwrap();
        assert_eq!(error, "Request stopped.");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn handles_stop_before_start_without_cancelling_the_next_request() {
        let requests = Requests::default();
        requests.cancel(1).unwrap();
        assert!(requests.start(1).is_err());
        let next = requests.start(2).unwrap();
        assert!(next.check().is_ok());
        requests.cancel(1).unwrap();
        assert!(next.check().is_ok());
        requests.finish(2).unwrap();
        assert!(requests.start(3).is_ok());
    }

    #[test]
    fn refuses_overlapping_requests_until_the_first_is_finished() {
        let requests = Requests::default();
        let first = requests.start(1).unwrap();
        assert!(requests.start(2).is_err());
        requests.cancel(1).unwrap();
        assert_eq!(first.check(), Err("Request stopped.".into()));
        assert!(requests.start(2).is_err());
        requests.finish(1).unwrap();
        assert!(requests.start(2).is_ok());
    }
}
