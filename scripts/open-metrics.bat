@echo off
setlocal
where py >nul 2>&1
if errorlevel 1 (
    python "%~dp0open-metrics.py" %*
) else (
    py -3 "%~dp0open-metrics.py" %*
)
exit /b %errorlevel%
