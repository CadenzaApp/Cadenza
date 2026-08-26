# Utility Scripts

Each script in this directory has two versions:
- a `.sh` file for running from MacOS
- a `.bat` file for running from Windows

Both should behave essentially identically.
Brief documentation is provided below for each script in this directory.
If you add your own script later, be sure to update this documentation and try your best to ensure
behavior parity between `.sh` and `.bat` versions of the script.

All scripts should be runnable from anywhere in the project. See `format.sh` and `format.bat` for some ideas on how to ensure that.

## `format`

Auto-format all code to meet the rust fmt and prettier standards.

MacOS
```sh
scripts/format.sh
```
Window
```bat
scripts\format.bat
```

To just check if everything meets formatting standards without changing any code, run with the `--check` flag. Useful for CI.
