# EL VAQUERO STORE

Tienda de recarga de diamantes Free Fire (Perú · Yape). Node 22+, **sin dependencias** (SQLite integrado).

## Qué incluye
- Tienda: inicio → juegos → ID de jugador → paquetes → pago Yape (tu QR original) → comprobante → pedido `EVS-AAAA-0001`.
- Panel admin en `/admin`: login, búsqueda por referencia/ID, ver y descargar comprobante, 5 estados.
- Base de datos SQLite en `DATA_DIR/store.db`; comprobantes en `DATA_DIR/uploads/` (no son públicos, solo el admin logueado los ve).
- Los precios los fija el servidor: el cliente no puede alterarlos.
- Todo pedido nace como **PENDIENTE DE VERIFICACIÓN**; nada se verifica automáticamente.

## Probar en tu computadora
```bash
ADMIN_PASSWORD="UnaClaveLarga2026" node server.js     # Windows PowerShell: $env:ADMIN_PASSWORD="..."; node server.js
```
Tienda: http://localhost:3000 · Panel: http://localhost:3000/admin (usuario `admin`)

## Variables de entorno
| Variable | Obligatoria | Descripción |
|---|---|---|
| `ADMIN_PASSWORD` | Sí (mín. 8 caracteres) | Contraseña del panel |
| `ADMIN_USER` | No (`admin`) | Usuario del panel |
| `DATA_DIR` | No | Carpeta de base de datos y comprobantes. **Debe ser un disco persistente.** |
| `PORT` | No (`3000`) | Puerto |
| `NODE_ENV=production` | Recomendado | Cookie de sesión `Secure` (requiere HTTPS) |

## Publicar en Internet (Render.com)
1. Sube esta carpeta a un repositorio de GitHub (privado está bien).
2. En render.com: **New → Blueprint** → elige el repositorio (usa `render.yaml`).
3. Escribe tu `ADMIN_PASSWORD` cuando lo pida y crea el servicio.
4. Render te da un enlace tipo `https://el-vaquero-store.onrender.com` con HTTPS. Ese es tu enlace público; el panel está en `/admin`.

> **Importante:** sin disco persistente (`/data`) los pedidos y comprobantes se borran en cada reinicio. Por eso el plan es de pago. Alternativas equivalentes: Railway o Fly.io con un volumen montado en `/data`, o un VPS con `docker run -d -p 80:3000 -v vaquero:/data -e ADMIN_PASSWORD=... -e NODE_ENV=production el-vaquero-store`.
> Haz copias de seguridad periódicas de la carpeta `/data`.

## Seguridad aplicada
Contraseña con scrypt, sesión por cookie HttpOnly/SameSite, límite de intentos de login y de pedidos por IP, validación del tipo real de imagen (no solo la extensión), límite de 5 MB, cabeceras CSP, protección CSRF en el panel, archivos de comprobantes con permisos 600 y nombres aleatorios.
Solo se pide el ID de jugador; nunca contraseñas de Free Fire.

## Antes de recibir clientes
- Cambia `ADMIN_PASSWORD` por una larga y única.
- Haz un pedido de prueba completo y bórralo/recházalo desde el panel.
- Confirma que el QR de `public/img/yape-qr.png` es el vigente.
