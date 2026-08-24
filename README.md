# OpenGym Coach for ChatGPT Sites

Adaptación móvil de [openGym](https://github.com/alexpcosta/opengym) para el runtime de ChatGPT Sites. Permite planificar rutinas, realizar sesiones guiadas, editar el historial, registrar peso corporal, consultar estadísticas y conectar ChatGPT mediante un MCP remoto autenticado.

## Capacidades

- Rutinas, plan semanal y cambios de un solo día.
- Sesiones guiadas con precarga de peso y repeticiones.
- Ejercicios por repeticiones o por tiempo.
- Historial editable y series omitidas.
- 1RM estimado, volumen muscular y peso corporal.
- Persistencia D1 por usuario con revisión optimista.
- OAuth 2.0/Auth0 y permisos `gym:read` / `gym:write`.
- MCP Streamable HTTP en `/mcp/` con herramientas de lectura y escritura.
- Importador determinista de Gym Coach que conserva ejercicios desconocidos.

## Configuración

La aplicación usa las variables de runtime documentadas en `.env.example`. En producción, `AUTH0_AUDIENCE` debe ser exactamente la URL MCP terminada en `/mcp/`; el Audience de Auth0, el parámetro OAuth `resource` y la metadata del recurso protegido deben coincidir literalmente.

## Desarrollo

```sh
npm install
npm test
npm run typecheck
npm run build
```

## Licencia y atribución

GNU AGPL-3.0. Esta obra se basa en openGym, creado originalmente por Duarte Santos y mantenido en el fork de referencia por Alex Costa. Consulta `LICENSE` y `NOTICE.md` para los avisos completos.
