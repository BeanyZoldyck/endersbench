import { modelAvatarPath, modelDisplayName } from '../model-identity';
import '../avatars.css';

export function ModelBuddy({ modelId, large = false }: { modelId: string; large?: boolean }) {
  const path = modelAvatarPath(modelId);
  return <span className={large ? 'model-logo model-buddy' : 'avatar model-buddy'} title={modelId}>
    {path ? <img src={path} alt={`${modelDisplayName(modelId)} buddy`} width={large ? 80 : 40} height={large ? 80 : 40} /> : <span aria-label={modelDisplayName(modelId)}>?</span>}
  </span>;
}
