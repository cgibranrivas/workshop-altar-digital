// GET /elements?altarId=...
//
// Trae los elementos de UN altar con un Query por altarId (nunca un Scan),
// en el orden en que se pusieron, y quita la sort key antes de devolverlos.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

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

export async function handler(event) {
  const altarId = event.queryStringParameters?.altarId
  if (!altarId) {
    return responder(400, { error: 'Falta altarId' })
  }

  const salida = await doc.send(
    new QueryCommand({
      TableName: TABLA,
      KeyConditionExpression: 'altarId = :a',
      ExpressionAttributeValues: { ':a': altarId },
      ScanIndexForward: true,
      Limit: 200,
    })
  )

  const elementos = (salida.Items || []).map(({ sk, ...resto }) => resto)
  return responder(200, { elementos })
}
