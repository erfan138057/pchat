@echo off
setlocal
rem Run pchat from this folder (portable: works wherever the folder is).
node "%~dp0bin\pchat.js" %*
