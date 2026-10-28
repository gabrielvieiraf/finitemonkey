import type { BlueprintText } from "./types.js";

export const es: BlueprintText = {
  problem: {
    title: "Problema y público por escrito",
    why: "Sin un problema y una persona con nombre, toda funcionalidad parece igual de urgente.",
    minimum: "Un párrafo: quién tiene el problema, cuánto le cuesta hoy, cómo lo resuelve ahora.",
  },
  rules: {
    title: "Reglas de negocio por escrito",
    why: "Una regla que solo vive en la cabeza de alguien se programa distinta en cada pantalla.",
    minimum: "Un documento en docs/ con las reglas que el código debe seguir, una por línea.",
  },
  pricing: {
    title: "Planes y precios",
    why: "El cobro, los límites y la página de venta dependen de lo que incluye cada plan.",
    minimum: "Una tabla de planes con precio, período y lo que libera cada uno.",
  },
  api: {
    title: "API separada de las pantallas",
    why: "Las reglas dentro de las pantallas no se pueden probar, reutilizar ni proteger en el servidor.",
    minimum: "Rutas de servidor en su propia carpeta, llamadas por las pantallas.",
  },
  database: {
    title: "Base de datos con migraciones",
    why: "Cambiar tablas a mano en producción pierde datos y no se puede repetir.",
    minimum: "Una carpeta de migraciones o un archivo de esquema que crea todas las tablas desde cero.",
  },
  auth: {
    title: "Cuentas e inicio de sesión",
    why: "Sin cuentas, cualquiera ve los datos de cualquiera.",
    minimum: "Registro, inicio y cierre de sesión con una biblioteca mantenida.",
  },
  "password-reset": {
    title: "Recuperación de contraseña",
    why: "La gente olvida la contraseña la primera semana; sin recuperación se va.",
    minimum: "Un enlace de cambio por correo que caduca y sirve una sola vez.",
  },
  tenants: {
    title: "Separación entre empresas clientes (B2B)",
    why: "En B2B, que una empresa vea los registros de otra termina el contrato.",
    minimum: "Cada consulta filtrada por el id de la empresa o del espacio de trabajo.",
  },
  states: {
    title: "Estados de carga, vacío y error",
    why: "Una pantalla que no muestra nada mientras carga o falla parece rota.",
    minimum: "Cada pantalla de datos tiene carga, vacío y error además del estado normal.",
  },
  billing: {
    title: "Cobro",
    why: "Sin cobrar, es una herramienta gratuita, no un SaaS.",
    minimum: "Checkout con un proveedor de pagos ligado a la cuenta.",
  },
  webhooks: {
    title: "Webhooks de pago idempotentes",
    why: "Los proveedores reenvían eventos; sin idempotencia un pago se aplica dos veces.",
    minimum: "Cada id de evento queda guardado y el repetido se ignora.",
  },
  "renewal-refund": {
    title: "Renovación y reembolso",
    why: "Las suscripciones se renuevan y la gente pide su dinero; las dos cosas cambian el acceso.",
    minimum: "La renovación extiende el acceso, el reembolso lo quita, ambos registrados.",
  },
  cents: {
    title: "Dinero en centavos",
    why: "El punto flotante convierte 0,1 + 0,2 en 0,30000000000000004 en una factura.",
    minimum: "Importes guardados y calculados como centavos enteros.",
  },
  types: {
    title: "Comprobación de tipos",
    why: "Los tipos detectan campos equivocados y valores faltantes antes que el usuario.",
    minimum: "Un comprobador de tipos configurado y ejecutándose en todo el proyecto.",
  },
  lint: {
    title: "Linter",
    why: "Un linter encuentra código sin uso y errores comunes en cada cambio.",
    minimum: "Un linter configurado para el lenguaje del proyecto.",
  },
  tests: {
    title: "Pruebas de las reglas de negocio",
    why: "Sin pruebas, cualquier cambio puede romper el cobro o el acceso sin que nadie lo vea.",
    minimum: "Pruebas de las reglas que mueven dinero o permisos, pasando en este árbol.",
  },
  ci: {
    title: "Integración continua",
    why: "Las comprobaciones que solo corren en un portátil dejan de correr.",
    minimum: "Un workflow de CI que ejecuta tipos, lint y pruebas en cada push.",
  },
  secrets: {
    title: "Secretos fuera del código",
    why: "Una clave subida una vez queda en el historial para cualquiera con el repositorio.",
    minimum: "Claves solo en variables de entorno; la comprobación de secretos pasa en este árbol.",
  },
  "rate-limit": {
    title: "Límite de peticiones",
    why: "Sin límites, un script tumba el servicio o prueba contraseñas sin parar.",
    minimum: "Un límite en el inicio de sesión y en las rutas públicas.",
  },
  privacy: {
    title: "Datos personales: base legal y borrado",
    why: "Las leyes de protección de datos exigen una forma de borrar o exportar los datos de una persona.",
    minimum: "Un camino de borrado de cuenta o de exportación de datos.",
  },
  backup: {
    title: "Copia de seguridad probada",
    why: "Una copia nunca restaurada es una suposición.",
    minimum: "Copia automática de la base de datos y una restauración hecha y anotada.",
  },
  environments: {
    title: "Entornos de prueba y producción",
    why: "Probar en producción la rompe para usuarios reales.",
    minimum: "Configuración separada por entorno, documentada en .env.example.",
  },
  rollback: {
    title: "Despliegue con vuelta atrás",
    why: "Un mal despliegue sin vuelta atrás deja el sitio caído mientras alguien lo arregla en vivo.",
    minimum: "Despliegues desde un pipeline, y la versión anterior vuelve en minutos.",
  },
  logs: {
    title: "Logs y alertas",
    why: "Sin logs, el primer aviso de un error llega de un cliente enfadado.",
    minimum: "Errores registrados con contexto y una alerta cuando se disparan.",
  },
  terms: {
    title: "Términos de uso y política de privacidad",
    why: "Cobrar y guardar datos personales sin ellos es un riesgo legal.",
    minimum: "Páginas de términos y privacidad enlazadas desde el registro.",
  },
  message: {
    title: "Una promesa clara",
    why: "Quien visita decide en segundos si la página es para él.",
    minimum: "Un titular que dice para quién es y qué obtiene.",
  },
  "call-to-action": {
    title: "Llamada a la acción",
    why: "Una página sin siguiente paso solo se lee.",
    minimum: "Un botón o enlace principal que lleva al siguiente paso.",
  },
  contact: {
    title: "Forma de contactarte",
    why: "Un visitante interesado sin forma de responder se pierde.",
    minimum: "Un formulario, correo o enlace de chat que llega a una persona.",
  },
  responsive: {
    title: "Funciona en el móvil",
    why: "La mayoría de las visitas a una página de venta vienen del móvil.",
    minimum: "Un diseño que se adapta a pantallas estrechas, con la etiqueta viewport.",
  },
  metadata: {
    title: "Título y vista previa al compartir",
    why: "El título y la vista previa son lo que se ve en la búsqueda y al compartir el enlace.",
    minimum: "Título de la página, descripción e imagen para compartir.",
  },
  analytics: {
    title: "Medición de visitas",
    why: "Sin números, nadie sabe si la página convierte.",
    minimum: "Un script de analítica que cuenta visitas y clics en el botón principal.",
  },
  "visual-check": {
    title: "Revisión visual",
    why: "Los desbordes y los diseños rotos solo aparecen al renderizar de verdad.",
    minimum: "La comprobación look pasa en este árbol.",
  },
  "landing-terms": {
    title: "Aviso de privacidad",
    why: "Un formulario que pide correo o teléfono recoge datos personales.",
    minimum: "Una página de privacidad enlazada junto al formulario.",
  },
  domain: {
    title: "Dominio propio con HTTPS",
    why: "Una dirección provisional y un aviso del navegador cuestan confianza.",
    minimum: "La página servida en su propio dominio por HTTPS.",
  },
};
