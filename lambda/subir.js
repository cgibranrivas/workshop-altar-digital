// POST /uploads        firma una URL de subida (PUT, 5 min)
// GET  /uploads/{proxy+} firma una URL de lectura (GET, 1 hora)
//
// El bucket es privado: la imagen no pasa por la Lambda, el navegador sube
// directo a S3 con la URL firmada y guarda solo la imageKey.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'

// requestChecksumCalculation WHEN_REQUIRED: así no se firma el checksum de un
// cuerpo vacío en la URL de PUT, que rompería el PUT del navegador.
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' })
const BUCKET = process.env.BUCKET

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

const responder = (statusCode, cuerpo) => ({
  statusCode,
  headers,
  body: JSON.stringify(cuerpo),
})

// Tipos de imagen permitidos y su extensión.
const EXTENSIONES = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function handler(event) {
  if (event.httpMethod === 'GET') {
    return leer(event)
  }
  return firmarSubida(event)
}

async function leer(event) {
  const imageKey = event.pathParameters?.proxy
  if (!imageKey) {
    return responder(400, { error: 'Falta la imageKey' })
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: imageKey }),
    { expiresIn: 3600 }
  )
  return responder(200, { url })
}

async function firmarSubida(event) {
  let cuerpo
  try {
    cuerpo = JSON.parse(event.body || '{}')
  } catch {
    return responder(400, { error: 'Cuerpo inválido' })
  }

  const { altarId, contentType } = cuerpo
  if (!altarId) {
    return responder(400, { error: 'Falta altarId' })
  }

  const ext = EXTENSIONES[contentType]
  if (!ext) {
    return responder(400, { error: 'El contentType no es una imagen' })
  }

  const imageKey = `${altarId}/${randomUUID()}.${ext}`
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: imageKey, ContentType: contentType }),
    { expiresIn: 300 }
  )

  return responder(200, { url, imageKey })
}
