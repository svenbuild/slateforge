@echo off
rem Command line tool for scripts and AI agents. Run "slateforge help".
rem Needs Node.js and a built app (npm run build).
node "%~dp0..\out\main\cli.js" %*
