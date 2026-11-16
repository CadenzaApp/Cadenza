@echo off
setlocal
where py >nul 2>&1
if errorlevel 1 (
    python "%~dp0..\deploy\release.py" %*
) else (
    py -3 "%~dp0..\deploy\release.py" %*
)
exit /b %errorlevel%
