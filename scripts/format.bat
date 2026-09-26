@echo off
rem
rem Run format.bat to apply formatting standards to all Rust/TypeScript/JavaScript/etc. files in the project.
rem Run format.bat --check to verify formatting without changing files.

setlocal

rem Some black magic to ensure these scripts can be run from anywhere and still work
set "PROJECT_ROOT=%~dp0.."


set "RUST_DIR=%PROJECT_ROOT%\backend-api"
set "REACT_NATIVE_DIR=%PROJECT_ROOT%\client-app"
set "PRETTIER_BIN=%REACT_NATIVE_DIR%\node_modules\.bin\prettier.cmd"

set "RUST_FMT_ARGS="
set "PRETTIER_ARGS=--write"

if "%~1"=="--check" (
  set "RUST_FMT_ARGS=--check"
  set "PRETTIER_ARGS=--check"
)

echo ----- 1. Rust format pass for files in %RUST_DIR% -----

cargo fmt --manifest-path "%RUST_DIR%\Cargo.toml" %RUST_FMT_ARGS%
if errorlevel 1 (
  call :format_failure "cargo fmt"
  exit /b 1
)
echo cargo fmt succeeded.

echo.
echo ----- 2. Prettier format pass for files in %REACT_NATIVE_DIR% -----

if not exist "%PRETTIER_BIN%" (
  echo Prettier is not installed. Run: npm ci --prefix client-app
  exit /b 1
)

call "%PRETTIER_BIN%" "%REACT_NATIVE_DIR%" %PRETTIER_ARGS%
if errorlevel 1 (
  call :format_failure "Prettier"
  exit /b 1
)
echo Prettier succeeded.

exit /b 0

:format_failure
echo.
echo Formatting check failed: %~1 found files that do not match the project's formatting standards.
echo.
echo Why this blocks a push:
echo   Consistent formatting keeps the code tidy and keeps merge conflicts to a minimum.
echo.
echo Fix it automatically:
echo   macOS/Linux: ./scripts/format.sh
echo   Windows:     scripts\format.bat
echo.
echo Then review the formatting changes, commit them, and push again.
exit /b 0
