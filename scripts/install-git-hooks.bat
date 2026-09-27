@echo off
setlocal

set "PROJECT_ROOT=%~dp0.."

git -C "%PROJECT_ROOT%" config core.hooksPath .githooks
if errorlevel 1 (
  echo Failed to install Git hooks.
  exit /b 1
)

echo Installed Git hooks from .githooks for this clone.
exit /b 0
