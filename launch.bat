@echo off
setlocal
cd /d "%~dp0"
title Infinite AI OS
node scripts\launch.mjs
if errorlevel 1 pause
