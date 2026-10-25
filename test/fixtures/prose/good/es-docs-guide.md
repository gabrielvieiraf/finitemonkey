# Instalar en un monorepo

En un monorepo, `finitemonkey init` crea un contrato por paquete. Lee los `workspaces` del `package.json` raíz y, si hay un `turbo.json`, usa los nombres de tarea que ya existen.

Si un paquete no tiene tests, el contrato de ese paquete queda sin el criterio de tests y el informe lo dice en una línea. No se inventa un comando.

Para quitarlo, ejecuta `finitemonkey uninstall` en la raíz. Los archivos que editaste se quedan y aparecen en la lista final.
