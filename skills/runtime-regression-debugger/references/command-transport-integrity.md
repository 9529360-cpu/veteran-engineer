# Command transport integrity across shells and hosts

Load this reference only when a coding task crosses PowerShell, CMD, WSL, Bash, SSH, a remote command tool, or another argument/string transport boundary. It owns **delivery of the intended program bytes and arguments**, not the semantics of the program being run, desktop UI shell integration, or the remote-execution runtime implementation.

## Failure model

Separate four independently falsifiable questions:

1. **Source:** Which exact script/argument payload was intended, at which repository/worktree HEAD?
2. **Transport:** Did the target receive identical bytes, ordering, encoding, and argument boundaries?
3. **Execution:** Which interpreter, working directory, environment, exit code, and captured output actually ran?
4. **Outcome:** Did the intended repository/runtime postcondition become true?

A command that exits successfully can execute only a truncated prefix. Output truncation is not evidence of input truncation, and a failing test is not proof the shell delivered the intended test command. Do not classify an application regression until source and transport have been discriminated.

## Prefer a single interpreter boundary

- Use the host's structured process API with executable + argument vector (no implicit shell) for simple commands. Pass each argument separately; do not serialize a complex argv array into one fragile command string.
- For **multi-line, nested, Unicode, or long commands**, stage a task-owned UTF-8 script file or pass bytes via a verified binary-safe stdin stream. Use only a short native launcher command with a small number of arguments.
- Avoid nesting PowerShell -Command -> wsl.exe -> bash -lc -> another quoted interpreter. More quoting/escaping or -EncodedCommand does not solve platform command-line length and can hide the failure.
- Before executing a staged program, compare the target-visible byte count and SHA-256 to the source payload. When byte-preserving transfer or readback is unavailable, treat long/complex command delivery as **unverified**; choose a smaller supported operation instead of pretending a retry proved the full payload.
- Treat task-owned scripts, logs, and processes as scoped resources. Do not overwrite unrelated files or kill shared sessions. Do not embed passwords, tokens, or secrets in command-line arguments, captured scripts, or diagnostic output.

## Windows PowerShell to WSL: file handoff

The following is a **pattern**, not a universal bootstrap. Provide the actual script text in the existing PowerShell variable $scriptSource, pick a unique task-owned destination in $windowsScript, and confirm that the selected WSL distro can see the file. Run one PowerShell line/step at a time when the host cannot preserve a larger invocation.

~~~powershell
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($windowsScript, $scriptSource, $utf8)
$expected = (Get-FileHash -LiteralPath $windowsScript -Algorithm SHA256).Hash.ToLowerInvariant()
$linuxScript = (& wsl.exe --exec wslpath -a -u $windowsScript).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxScript) { throw 'WSL path conversion failed' }
$shaLine = & wsl.exe --exec sha256sum -- $linuxScript
if ($LASTEXITCODE -ne 0) { throw 'WSL could not read the staged script' }
$actual = ($shaLine -split '\s+')[0].ToLowerInvariant()
if ($actual -ne $expected) { throw 'Script payload differs across Windows/WSL' }
& wsl.exe --exec bash -- $linuxScript
if ($LASTEXITCODE -ne 0) { throw "WSL script exited with $LASTEXITCODE" }
~~~

If paths or byte comparisons fail, fix only that transport boundary. Do not compensate by weakening tests or shortening the intended program. WSL's selected distro, mount visibility, and tool availability must be checked rather than assumed. UTF-8 without BOM avoids shell shebang/BOM surprises; hashes detect transformations but do not by themselves prove a correct worktree or safe effect. Preserve the staged file on an unexplained failure until the diagnostic evidence is captured; clean up only task-owned resources after proof.

## Execute, classify, recover

Classify an observed failure before deciding to rerun:

| Evidence | Failure owner | Next discriminating action |
| --- | --- | --- |
| Source vs target digest or size differs | transport | repair encoding/staging/stream, compare again |
| Digest matches, target executable/path/argv wrong | invocation | fix interpreter/argv/cwd, inspect one bounded trace |
| Exact payload and argv match, program fails | script/application/environment | inspect actual failing location, run smallest reproducer |
| Program exits 0, intended files/runtime not changed | outcome | inspect exact HEAD, output artifact and postcondition |
| Host response missing after mutation | unknown effect | re-read authoritative target before any non-idempotent retry |

Change one causal variable at a time. Never repeat the same failed nested command with more escaping and call it debugging. After two transport attempts without a new discriminator, switch to a file/stream transfer or report the concrete missing capability. Report payload identity, command exit status, and **independent postcondition evidence** separately; none substitutes for the others.

## Special cases

- Do not interpolate untrusted filenames, script text, or repository content into shell code. Use exact filesystem APIs, literal paths, and argument vectors. A hash comparison is not input sanitization.
- A tool may truncate returned stdout/stderr for display; retain bounded logs and exit status, and fetch targeted error ranges rather than rerun.
- For remote GitHub-only work, use the repository connector to mutate/read commits, and GitHub Actions for test execution. Do not invent a local terminal merely to satisfy this reference.
