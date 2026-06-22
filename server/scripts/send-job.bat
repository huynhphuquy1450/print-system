@echo off
REM send-job.bat - Wrapper CMD cho send-job.ps1
REM Usage:
REM   send-job.bat <pdf-path> [-b branch_id] [-p printer_name]
REM Example:
REM   send-job.bat "C:\Users\Huynh Phu Quy\Documents\contract.pdf"
REM   send-job.bat "D:\contract.pdf" -b br_001 -p "Brother HL-L2360D"

powershell -ExecutionPolicy Bypass -File "%~dp0send-job.ps1" %*
