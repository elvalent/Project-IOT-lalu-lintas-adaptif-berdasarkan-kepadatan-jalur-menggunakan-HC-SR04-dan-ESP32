@echo off
title Lalu Lintas Adaptif - Node.js + SQLite
cd /d "%~dp0server"
echo.
echo Memeriksa dan memasang dependency backend...
call npm install
if errorlevel 1 (
  echo.
  echo Gagal install dependency. Periksa koneksi internet dan Node.js.
  pause
  exit /b 1
)
echo.
echo Menjalankan backend dan database...
echo Buka browser: http://localhost:3000
echo Tutup jendela ini atau tekan Ctrl+C untuk menghentikan server.
call npm start
pause
