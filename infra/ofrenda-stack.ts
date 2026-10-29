// El stack del altar.
//
// La tarea 1 de la spec (.kiro/specs/ofrenda/tasks.md) construye aquí el
// backend, siguiendo Architecture, Data Models y Components and Interfaces de
// design.md:
//
//   - una tabla de DynamoDB (partition key altarId, sort key sk)
//   - un bucket privado de S3 para las imágenes
//   - tres Lambdas en JavaScript plano (lambda/), con permisos acotados
//   - una REST API con GET/POST /elements, POST /uploads y GET /uploads/{proxy+}

import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'

export class OfrendaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // La tabla: una sola partición por altar, orden por fecha en la sort key.
    // La llave no se toca: un cambio aquí puede borrar los elementos del altar.
    const tabla = new dynamodb.Table(this, 'Tabla', {
      tableName: 'ofrenda-elementos',
      partitionKey: { name: 'altarId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // El bucket de imágenes: privado. Solo se ve con una URL firmada.
    const bucket = new s3.Bucket(this, 'Imagenes', {
      bucketName: `ofrenda-imagenes-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    })

    // Config común de las tres Lambdas. JavaScript plano desde lambda/, sin
    // build: Code.fromAsset empaqueta la carpeta tal cual, con su package.json.
    const comun = {
      runtime: lambda.Runtime.NODEJS_24_X,
      code: lambda.Code.fromAsset('lambda'),
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
    }

    const listar = new lambda.Function(this, 'Listar', {
      ...comun,
      handler: 'listar.handler',
      environment: { TABLA: tabla.tableName },
    })
    tabla.grantReadData(listar)

    const agregar = new lambda.Function(this, 'Agregar', {
      ...comun,
      handler: 'agregar.handler',
      environment: { TABLA: tabla.tableName },
    })
    tabla.grantReadWriteData(agregar)

    const subir = new lambda.Function(this, 'Subir', {
      ...comun,
      handler: 'subir.handler',
      environment: { BUCKET: bucket.bucketName },
    })
    bucket.grantPut(subir)
    bucket.grantRead(subir)

    // La REST API: cuatro rutas, stage v1, CORS abierto.
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'ofrenda',
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST'],
        allowHeaders: ['Content-Type'],
      },
    })

    const elements = api.root.addResource('elements')
    elements.addMethod('GET', new apigateway.LambdaIntegration(listar))
    elements.addMethod('POST', new apigateway.LambdaIntegration(agregar))

    const uploads = api.root.addResource('uploads')
    uploads.addMethod('POST', new apigateway.LambdaIntegration(subir))
    // Proxy greedy: el imageKey lleva un '/', un path param normal lo cortaría.
    uploads.addResource('{proxy+}').addMethod('GET', new apigateway.LambdaIntegration(subir))

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url })
  }
}
