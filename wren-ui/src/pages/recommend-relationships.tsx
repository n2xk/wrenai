import { Skeleton } from 'antd';
import { Path } from '@/utils/enum';
import { createCompatibilityRuntimeRedirectPage } from '@/utils/compatibilityRoutes';
import { buildModelingAssistantWorkbenchParams } from '@/features/modeling/assistant/modelingAssistantRoutes';

export default createCompatibilityRuntimeRedirectPage({
  legacyRoute: Path.RecommendRelationships,
  canonicalRoute: Path.Knowledge,
  buildQuery: () => buildModelingAssistantWorkbenchParams('relationships'),
  fallback: <Skeleton active paragraph={{ rows: 4 }} />,
});
