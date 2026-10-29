// Donde se guarda el altar.
//
// ---------------------------------------------------------------------
//  ESTE ES EL UNICO ARCHIVO QUE CAMBIA EN EL MODULO 3.
// ---------------------------------------------------------------------
//
// Antes todo se guardaba en el localStorage de ESTE navegador. Ahora este
// archivo le habla a tu propia API: el altar vive en DynamoDB y S3, y la
// misma URL lo abre desde cualquier dispositivo.
//
// Las cuatro funciones de abajo mantienen su firma y siguen siendo async,
// asi que los componentes no se tocan ni una linea. Por eso `agregar`
// recibe el File crudo de la imagen y lo procesa AQUI: ahora lo sube a S3
// con una URL firmada y guarda solo su imageKey.

import { reducirABlob } from '../lib/imagen.js'

// Lo que hace ESTE archivo de verdad: hablarle a la nube. El banner de la
// pagina se acomoda a este dato.
export const MODO = 'nube'

const LLAVE = 'ofrenda:elementos'
const LLAVE_NOMBRE = 'ofrenda:nombre'

// La URL de la API sale del entorno (nunca escrita en el codigo) y se
// normaliza sin diagonal final para armar rutas sin dobles //.
const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// El hostname de la pagina identifica el altar: la misma URL (laptop o
// telefono) consulta la misma particion.
const altarId = window.location.hostname

async function pedir(ruta, opciones) {
  const res = await fetch(`${API}${ruta}`, opciones)
  if (!res.ok) {
    throw new Error(`La API respondio ${res.status}`)
  }
  return res.json()
}

/** Todos los elementos del altar, en el orden en que se pusieron. */
export async function listar() {
  const { elementos } = await pedir(`/elements?altarId=${encodeURIComponent(altarId)}`)
  // En la primera carga desde la laptop, si la API esta vacia, sube lo que
  // ya existe en localStorage para que el altar no se vea en blanco.
  if (elementos.length === 0) {
    const importados = await importarDesdeLocalStorage()
    if (importados.length > 0) return importados
  }
  return elementos
}

/**
 * Agrega un elemento y devuelve como quedo guardado.
 *
 * Si trae `imagen` (el File del formulario), aqui se reduce y se sube a S3
 * con una URL firmada; en el elemento solo queda su `imageKey`. El
 * componente nunca sabe que paso con el archivo: solo lo entrega.
 */
export async function agregar(elemento) {
  const { imagen, ...resto } = elemento
  if (imagen) {
    resto.imageKey = await subirImagen(imagen)
  }
  return pedir('/elements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...resto, altarId }),
  })
}

/** Quita un elemento del altar. */
export async function borrar(id) {
  await pedir('/elements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ altarId, borrar: true, id }),
  })
}

/**
 * De donde sale la imagen de un elemento.
 *
 * El elemento solo guarda su `imageKey`. Aqui se pide la URL firmada de
 * lectura a la API.
 */
export async function urlDeImagen(elemento) {
  if (!elemento.imageKey) return null
  const { url } = await pedir(`/uploads/${elemento.imageKey}`)
  return url
}

/** Quien esta poniendo cosas en el altar. Se pregunta una sola vez. */
export function nombre() {
  return localStorage.getItem(LLAVE_NOMBRE) || ''
}

export function guardarNombre(valor) {
  localStorage.setItem(LLAVE_NOMBRE, valor.slice(0, 40))
}

// ---------------------------------------------------------------------
// Primera carga: importar el altar que vivia en este navegador.
// ---------------------------------------------------------------------

// Sube un File o Blob reducido a S3 con una URL firmada y devuelve su
// imageKey.
async function subirImagen(archivo) {
  const blob = await reducirABlob(archivo)
  const { url, imageKey } = await pedir('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ altarId, contentType: 'image/jpeg' }),
  })
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  })
  if (!put.ok) {
    throw new Error(`No pude subir la imagen (${put.status})`)
  }
  return imageKey
}

// Convierte una data URL guardada en localStorage a Blob para resubirla.
function dataUrlABlob(dataUrl) {
  const [encabezado, base64] = dataUrl.split(',')
  const tipo = encabezado.match(/data:(.*?);base64/)?.[1] || 'image/jpeg'
  const bytes = atob(base64)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: tipo })
}

async function importarDesdeLocalStorage() {
  let locales
  try {
    const crudo = localStorage.getItem(LLAVE)
    if (!crudo) return []
    locales = JSON.parse(crudo)
  } catch {
    return []
  }
  if (!Array.isArray(locales) || locales.length === 0) return []

  const subidos = []
  for (const el of locales) {
    const { imagenLocal, id, creadoEn, posicion, imagen, ...resto } = el
    const nuevo = { ...resto }
    if (imagenLocal) {
      nuevo.imageKey = await subirImagen(dataUrlABlob(imagenLocal))
    }
    const guardado = await pedir('/elements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...nuevo, altarId }),
    })
    subidos.push(guardado)
  }
  return subidos
}
