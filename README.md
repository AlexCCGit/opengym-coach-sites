# OpenGym Coach for ChatGPT Sites

Adaptación completa de [openGym](https://github.com/alexpcosta/opengym) para ChatGPT Sites, Cloudflare D1, MCP remoto y Android. El Site público vive en [opengym-coach.alexcocl.chatgpt.site](https://opengym-coach.alexcocl.chatgpt.site).

## Capacidades

- Catálogo abierto de más de 1300 ejercicios con filtros, medios, instrucciones y ejercicios personalizados.
- Editor integral de rutinas, plan semanal, excepciones diarias, superseries y plan compartible/imprimible.
- Sesiones guiadas de repeticiones, tiempo y cardio; precarga, RIR/RPE, descanso sonoro, wake lock y marcas personales.
- Progresión manual, lineal, Greyskull, doble y temporal, con estancamientos y descarga automática.
- Historial editable, peso corporal con objetivo/gráfico, 1RM, resumen semanal, racha, heatmap y mapa muscular.
- Coach AI mediante OpenAI Responses API con fallback local determinista, recordatorios y panel administrativo.
- Temas claro/oscuro/sistema, tres acentos y selector de 12 idiomas.
- Importación de JSON, Gym Coach, Strong, Hevy, FitNotes y Apple Health; exportación JSON completa.
- PWA offline y proyecto Android Capacitor con archivos, notificaciones locales y compartir nativo.
- Persistencia D1 por usuario con revisión optimista, OAuth 2.0/Auth0 y MCP Streamable HTTP.

## Configuración

La aplicación usa las variables de runtime documentadas en `.env.example`. En producción, `AUTH0_AUDIENCE` debe ser exactamente la URL MCP terminada en `/mcp/`; el Audience de Auth0, el parámetro OAuth `resource` y la metadata del recurso protegido deben coincidir literalmente. `OPENAI_API_KEY` es opcional y nunca se envía al navegador.

## Desarrollo

```sh
npm install
npm test
npm run typecheck
npm run build
```

Para generar el APK de depuración:

```sh
npm run android:apk
```

El artefacto queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Un APK de distribución requiere una firma propia y no debe reutilizar la clave de depuración.

## Licencia y atribución

GNU AGPL-3.0. Esta obra se basa en openGym, creado originalmente por Duarte Santos y mantenido en el fork de referencia por Alex Costa. Consulta `LICENSE` y `NOTICE.md` para los avisos completos.
