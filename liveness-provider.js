import { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand } from '@aws-sdk/client-rekognition';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

export function awsLivenessProvider(settings,clients={}) {
  const credentials = settings.accessKeyId && settings.secretAccessKey ? { accessKeyId:settings.accessKeyId,secretAccessKey:settings.secretAccessKey,...(settings.sessionToken ? {sessionToken:settings.sessionToken} : {}) } : undefined;
  const options = { region:settings.region,credentials,maxAttempts:2 };
  const rekognition = clients.rekognition ?? new RekognitionClient(options), sts = clients.sts ?? new STSClient(options);
  return {
    async create(id) {
      const result = await rekognition.send(new CreateFaceLivenessSessionCommand({ClientRequestToken:id,Settings:{AuditImagesLimit:2}}),{abortSignal:AbortSignal.timeout(12000)});
      if (!result.SessionId) throw new Error('MissingSession');
      return result.SessionId;
    },
    async result(sessionId) {
      const result = await rekognition.send(new GetFaceLivenessSessionResultsCommand({SessionId:sessionId}),{abortSignal:AbortSignal.timeout(12000)});
      return {sessionId:result.SessionId,status:result.Status,confidence:result.Confidence,reference:result.ReferenceImage?.Bytes,audit:(result.AuditImages ?? []).map(image=>image.Bytes).filter(Boolean)};
    },
    async credentials(attemptId) {
      const result = await sts.send(new AssumeRoleCommand({
        RoleArn:settings.browserRoleArn,RoleSessionName:'mv-' + attemptId,DurationSeconds:900,
        Policy:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'rekognition:StartFaceLivenessSession',Resource:'*',Condition:{StringEquals:{'aws:RequestedRegion':settings.region}}}]})
      }),{abortSignal:AbortSignal.timeout(12000)});
      const c=result.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new Error('MissingCredentials');
      return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration?.toISOString()};
    }
  };
}
