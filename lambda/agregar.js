// POST /elements
//
// Crea un elemento (201) o, si el cuerpo trae `borrar: true` + `id`, lo borra.
// La API pone id, creadoEn, posicion y sk: nunca confía en que el cliente los
// mande. Solo acepta del cliente los campos permitidos.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'node:crypto'

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLA = process.env.TABLA

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

const responder = (statusCode, cuerpo) => ({
  statusCode,
  headers,
  body: JSON.stringify(cuerpo),
})

// Solo estos campos vienen del cliente. posicion se calcula en el servidor;
// cualquier otro campo se ignora.
const CAMPOS = ['tipo', 'nivel', 'texto', 'link', 'puestoPor', 'imageKey']

export async function handler(event) {
  let cuerpo
  try {
    cuerpo = JSON.parse(event.body || '{}')
  } catch {
    return responder(400, { error: 'Cuerpo inválido' })
  }

  const { altarId } = cuerpo
  if (!altarId) {
    return responder(400, { error: 'Falta altarId' })
  }

  if (cuerpo.borrar === true) {
    return borrar(altarId, cuerpo.id)
  }

  if (!cuerpo.tipo) {
    return responder(400, { error: 'Falta tipo' })
  }

  // Filtra los campos permitidos.
  const elemento = {}
  for (const campo of CAMPOS) {
    if (cuerpo[campo] !== undefined) elemento[campo] = cuerpo[campo]
  }

  const nivel = elemento.nivel ?? 1

  // Cuenta cuántos hay ya en ese nivel para la posicion.
  const existentes = await doc.send(
    new QueryCommand({
      TableName: TABLA,
      KeyConditionExpression: 'altarId = :a',
      FilterExpression: 'nivel = :n',
      ExpressionAttributeValues: { ':a': altarId, ':n': nivel },
      Select: 'COUNT',
    })
  )

  const id = randomUUID()
  const creadoEn = new Date().toISOString()
  const guardado = {
    ...elemento,
    altarId,
    nivel,
    posicion: existentes.Count || 0,
    id,
    creadoEn,
  }

  await doc.send(
    new PutCommand({
      TableName: TABLA,
      Item: { ...guardado, sk: `${creadoEn}#${id}` },
    })
  )

  return responder(201, guardado)
}

async function borrar(altarId, id) {
  if (!id) {
    return responder(400, { error: 'Falta id' })
  }

  // Busca el item por id dentro del altar para conseguir su sk.
  const salida = await doc.send(
    new QueryCommand({
      TableName: TABLA,
      KeyConditionExpression: 'altarId = :a',
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: { ':a': altarId, ':id': id },
    })
  )

  const item = (salida.Items || [])[0]
  if (!item) {
    return responder(404, { error: 'No existe ese elemento en este altar' })
  }

  await doc.send(
    new DeleteCommand({
      TableName: TABLA,
      Key: { altarId, sk: item.sk },
    })
  )

  return responder(200, { borrado: id })
}
