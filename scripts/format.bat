@echo off
rem
rem Run format.bat to apply formatting standards to all Rust/TypeScript/JavaScript/etc. files in the project.
rem Run format.bat --check to check whether the current formatting passes the formatting standards.

setlocal

rem Some black magic to ensure these scripts can be run from anywhere and still work
set "PROJECT_ROOT=%~dp0.."


set "RUST_DIR=%PROJECT_ROOT%\backend-api"
set "REACT_NATIVE_DIR=%PROJECT_ROOT%\client-app"

set "RUST_FMT_ARGS="
set "PRETTIER_ARGS=--write"

if "%~1"=="--check" (
  set "RUST_FMT_ARGS=--check"
  set "PRETTIER_ARGS=--check"
)

echo ----- 1. Rust format pass for files in %RUST_DIR% -----

cargo fmt --manifest-path "%RUST_DIR%\Cargo.toml" %RUST_FMT_ARGS%
if errorlevel 1 (
  echo cargo fmt failed!
  exit /b 1
)
echo cargo fmt succeeded.

echo.
echo ----- 2. Prettier format pass for files in %REACT_NATIVE_DIR% -----

call npx --prefix "%REACT_NATIVE_DIR%" prettier "%REACT_NATIVE_DIR%" %PRETTIER_ARGS%
if errorlevel 1 (
  echo Prettier failed!
  exit /b 1
)
echo Prettier succeeded.

exit /b 0
