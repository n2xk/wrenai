import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchArtifactKind } from './threadWorkbenchState';

export type ThreadWorkbenchLocale = 'zh-CN' | 'en-US';

export type ThreadWorkbenchMessages = {
  answer: {
    badge: string;
  };
  close: string;
  headerActions: {
    pinDashboard: string;
    spreadsheet: string;
  };
  chart: {
    badge: string;
    alerts: {
      failedShort: string;
    };
    actions: {
      create: string;
      generating: string;
      regenerate: string;
      unavailable: string;
      view: string;
    };
    descriptions: {
      askCreate: string;
      askFailed: string;
      askGenerating: string;
      askReady: string;
      followUpGenerating: string;
      followUpReady: string;
      noChartFallback: string;
    };
    statuses: {
      enhance: string;
      failed: string;
      generated: string;
      generating: string;
    };
    syntheticQuestion: string;
    teaserTitle: string;
  };
  recommendation: {
    actions: {
      retry: string;
    };
    alerts: {
      failedShort: string;
    };
    badge: string;
    categories: {
      chartFollowUp: string;
      chartRefine: string;
      compare: string;
      distribution: string;
      drillDown: string;
      ranking: string;
      relatedQuestion: string;
      trend: string;
    };
    notifications: {
      generateFailed: string;
      sourceNotReady: string;
    };
    sectionIntro: string;
    sectionTitle: string;
    triggerLabel: string;
  };
  footer: {
    helpfulNegative: string;
    helpfulPositive: string;
    helpfulPrompt: string;
    openSavedView: string;
    saveSqlTemplate: string;
    saveView: string;
    viewSaved: string;
  };
  preview: {
    emptyDescription: string;
    refresh: string;
    rowLimitHint: string;
    teaserAction: string;
    teaserDescription: string;
    teaserTag: string;
    teaserTitle: string;
    viewResult: string;
  };
  sql: {
    adjust: string;
    copied: string;
    copy: string;
    copyFailed: string;
    view: string;
  };
  template: {
    badges: {
      anchored: string;
      anchoredGenerated: string;
      correctedTemplate: string;
      executable: string;
      knowledgeAnswer: string;
      llmGenerated: string;
      missingExternalData: string;
      reference: string;
      trustedReference: string;
    };
    labels: {
      analysisRulesMatched: string;
      analysisRulesMatchedSuffix: string;
      analysisRulesNotMatched: string;
      decisionReason: string;
      fallbackReason: string;
      historyContinuity: string;
      missingParameters: string;
      mode: string;
      noSqlFlow: string;
      notMatched: string;
      parameters: string;
      requiredExternalDependencies: string;
      sqlTemplateReference: string;
      sqlSource: string;
      template: string;
      templateId: string;
    };
    reasons: {
      explicitBusinessTemplateSelected: string;
      inactiveTemplate: string;
      missingTemplateParameters: string;
      missingExternalData: string;
      missingRequiredSlot: string;
      noSqlPairCandidates: string;
      referenceSqlPairSelected: string;
      templateConfidenceBelowThreshold: string;
      templateConflictLowMargin: string;
      templateCoreProtectionRejectedCorrection: string;
      templateDryRunFailed: string;
      templateGuardChannelPeriodSummaryMismatch: string;
      templateGuardLoginWithoutDepositMismatch: string;
      templateGuardPlainSqlRequested: string;
      templateSchemaRetrievalInsufficient: string;
      trustedReferenceSelected: string;
    };
    sqlSources: {
      anchoredGenerated: string;
      anchoredTemplate: string;
      corrected: string;
      directGenerated: string;
      generated: string;
      renderedTemplate: string;
    };
  };
  tabs: Record<WorkbenchArtifactKind, string>;
  titleLabel: string;
};

const THREAD_WORKBENCH_MESSAGE_CATALOG: Record<
  ThreadWorkbenchLocale,
  ThreadWorkbenchMessages
> = {
  'zh-CN': {
    answer: {
      badge: '自动分析',
    },
    close: '关闭结果区',
    headerActions: {
      spreadsheet: '保存为数据表',
      pinDashboard: '固定到看板',
    },
    titleLabel: '结果工作台',
    footer: {
      helpfulPrompt: '这个结果有帮助吗？',
      helpfulPositive: '有帮助',
      helpfulNegative: '没有帮助',
      saveSqlTemplate: '保存为 SQL 模板',
      saveView: '保存为视图',
      viewSaved: '已保存视图',
      openSavedView: '查看已保存视图',
    },
    tabs: {
      preview: '数据预览',
      sql: 'SQL 查询',
      chart: '图表',
    },
    preview: {
      teaserTitle: '数据预览',
      teaserTag: '结果',
      teaserDescription: '在右侧查看当前结果明细，并继续切换 SQL 与数据。',
      teaserAction: '查看数据',
      refresh: '刷新结果',
      emptyDescription: '未找到符合当前查询条件的数据记录。',
      rowLimitHint: '最多展示 500 行',
      viewResult: '查看结果',
    },
    sql: {
      copy: '复制 SQL',
      adjust: '调整 SQL',
      copied: '已复制当前显示的 SQL。',
      copyFailed: '复制 SQL 失败，请稍后重试。',
      view: '查看 SQL',
    },
    template: {
      badges: {
        anchored: '已按业务口径模板生成',
        anchoredGenerated: '已按业务口径约束生成',
        correctedTemplate: '已在模板保护下修正 SQL',
        executable: '已执行参数化模板',
        knowledgeAnswer: '已按业务知识回答',
        llmGenerated: '未命中模板，直接生成 SQL',
        missingExternalData: '需要补充外部数据',
        reference: '已按 SQL 参考生成',
        trustedReference: '已采用可信 SQL 参考',
      },
      labels: {
        analysisRulesMatched: '分析规则：已命中 ',
        analysisRulesMatchedSuffix: ' 条',
        analysisRulesNotMatched: '分析规则：未命中',
        template: '模板：',
        templateId: '模板 ID：',
        mode: '模式：',
        noSqlFlow: '未进入 SQL 生成',
        sqlTemplateReference: 'SQL 模板/参考：',
        sqlSource: 'SQL 来源：',
        decisionReason: '决策依据：',
        fallbackReason: '降级原因：',
        missingParameters: '缺少参数：',
        notMatched: '未命中',
        parameters: '参数：',
        requiredExternalDependencies: '外部依赖：',
        historyContinuity: '追问连续性：已匹配上一轮模板上下文',
      },
      reasons: {
        explicitBusinessTemplateSelected: '已命中业务口径模板',
        inactiveTemplate: '模板已停用，未直接采用',
        missingTemplateParameters: '模板必填参数不完整，已降级处理',
        missingExternalData: '当前问题依赖外部数据，已转为补充数据提示',
        missingRequiredSlot: '缺少必填业务参数，已先返回追问提示',
        noSqlPairCandidates: '未命中 SQL 模板/参考样例',
        referenceSqlPairSelected: '已命中相关 SQL 参考样例',
        templateConfidenceBelowThreshold: '模板置信度不足，已降级为参考生成',
        templateConflictLowMargin: '候选模板差距不足，未自动套用',
        templateCoreProtectionRejectedCorrection:
          '修正会破坏模板核心骨架，已拒绝套用',
        templateDryRunFailed: '模板直执行未通过 dry-run 校验，已降级为约束生成',
        templateGuardChannelPeriodSummaryMismatch:
          '当前问题要求按渠道区间汇总，不适合直接套用日级或分层等其他粒度模板',
        templateGuardLoginWithoutDepositMismatch:
          '当前问题是登录未充值反查，不适合直接套用充值或首存模板',
        templateGuardPlainSqlRequested:
          '当前问题明确要求直接查询原始数据，未直接套用业务报表模板',
        templateSchemaRetrievalInsufficient:
          '模板缺少足够的 schema 召回支撑，未直接套用',
        trustedReferenceSelected: '已命中可信 SQL 参考',
      },
      sqlSources: {
        generated: 'LLM 参考生成',
        directGenerated: 'LLM 直接生成',
        anchoredGenerated: '按业务口径约束生成',
        anchoredTemplate: '直接复用业务口径模板',
        renderedTemplate: '直接渲染参数化模板',
        corrected: '修正后的 SQL',
      },
    },
    chart: {
      badge: '图表追问',
      teaserTitle: '图表',
      statuses: {
        generated: '已生成',
        failed: '失败',
        generating: '生成中',
        enhance: '增强',
      },
      descriptions: {
        followUpReady: '图表已生成，可在右侧继续查看。',
        followUpGenerating: '正在根据当前结果生成图表。',
        askReady: '已有图表结果，可直接在右侧查看。',
        askFailed: '图表生成失败，可重新发起。',
        askGenerating: '正在根据当前结果生成图表。',
        askCreate: '基于当前结果生成图表。',
        noChartFallback: '图表生成失败，请重新生成。',
      },
      actions: {
        view: '查看图表',
        regenerate: '重新生成',
        generating: '生成中',
        unavailable: '暂不可生成',
        create: '生成图表',
      },
      alerts: {
        failedShort: '图表生成失败',
      },
      syntheticQuestion: '生成图表',
    },
    recommendation: {
      badge: '推荐问题',
      triggerLabel: '推荐几个问题给我',
      sectionTitle: '推荐追问',
      sectionIntro: '基于刚刚这条结果，你接下来还可以问：',
      alerts: {
        failedShort: '推荐问题生成失败',
      },
      actions: {
        retry: '重新生成',
      },
      notifications: {
        sourceNotReady: '当前回答尚未就绪，请稍后再试',
        generateFailed: '生成推荐追问失败，请稍后重试',
      },
      categories: {
        drillDown: '深挖',
        compare: '对比',
        trend: '趋势',
        distribution: '分布',
        ranking: '排行',
        chartFollowUp: '转成图表',
        chartRefine: '优化图表',
        relatedQuestion: '相关问题',
      },
    },
  },
  'en-US': {
    answer: {
      badge: 'Auto analysis',
    },
    close: 'Close workbench',
    headerActions: {
      spreadsheet: 'Spreadsheet',
      pinDashboard: 'Pin to dashboard',
    },
    titleLabel: 'Result workbench',
    footer: {
      helpfulPrompt: 'Was this result helpful?',
      helpfulPositive: 'Helpful',
      helpfulNegative: 'Not helpful',
      saveSqlTemplate: 'Save as SQL template',
      saveView: 'Save as view',
      viewSaved: 'Saved view',
      openSavedView: 'Open saved view',
    },
    tabs: {
      preview: 'Data Preview',
      sql: 'SQL Query',
      chart: 'Chart',
    },
    preview: {
      teaserTitle: 'Data Preview',
      teaserTag: 'Result',
      teaserDescription:
        'Inspect the current result in the workbench and switch between SQL and data.',
      teaserAction: 'View data',
      refresh: 'Refresh result',
      emptyDescription: 'No rows matched the current query.',
      rowLimitHint: 'Showing up to 500 rows',
      viewResult: 'View result',
    },
    sql: {
      copy: 'Copy SQL',
      adjust: 'Adjust SQL',
      copied: 'Copied the current SQL.',
      copyFailed: "Couldn't copy SQL. Please try again.",
      view: 'View SQL',
    },
    template: {
      badges: {
        anchored: 'Anchored business template used',
        anchoredGenerated: 'Generated under business-template constraints',
        correctedTemplate: 'Template SQL corrected with core protection',
        executable: 'Parameterized template executed',
        knowledgeAnswer: 'Answered from business knowledge',
        llmGenerated: 'No template matched; SQL generated directly',
        missingExternalData: 'External data required',
        reference: 'Generated from SQL reference',
        trustedReference: 'Trusted SQL reference applied',
      },
      labels: {
        analysisRulesMatched: 'Analysis rules: matched ',
        analysisRulesMatchedSuffix: ' rule(s)',
        analysisRulesNotMatched: 'Analysis rules: not matched',
        template: 'Template: ',
        templateId: 'Template ID: ',
        mode: 'Mode: ',
        noSqlFlow: 'SQL generation was not entered',
        sqlTemplateReference: 'SQL template/reference: ',
        sqlSource: 'SQL source: ',
        decisionReason: 'Decision: ',
        fallbackReason: 'Fallback reason: ',
        missingParameters: 'Missing parameters: ',
        notMatched: 'not matched',
        parameters: 'Parameters: ',
        requiredExternalDependencies: 'External dependencies: ',
        historyContinuity:
          'Follow-up continuity: matched previous template context',
      },
      reasons: {
        explicitBusinessTemplateSelected:
          'Matched an explicit business template',
        inactiveTemplate: 'Template is inactive and was not applied directly',
        missingTemplateParameters: '业务模板缺少必填参数，已降级为安全处理',
        missingExternalData:
          'The question depends on external data, so the answer asks for more data',
        missingRequiredSlot: '缺少必要业务参数，已先发起澄清',
        noSqlPairCandidates: 'No SQL template/reference candidates matched',
        referenceSqlPairSelected: 'Matched a related SQL reference sample',
        templateConfidenceBelowThreshold:
          'Template confidence was too low, so the flow downgraded safely',
        templateConflictLowMargin:
          'Competing templates were too close to auto-apply safely',
        templateCoreProtectionRejectedCorrection:
          '已拦截可能改变业务口径的 SQL 修正',
        templateDryRunFailed:
          'Direct template execution failed dry-run validation and fell back safely',
        templateGuardChannelPeriodSummaryMismatch:
          'The question asks for channel-period aggregation, so daily or segmented templates were not applied directly',
        templateGuardLoginWithoutDepositMismatch:
          'The question asks for login-without-deposit players, so deposit/cohort templates were not applied directly',
        templateGuardPlainSqlRequested:
          'The question explicitly asks for raw/direct SQL, so business report templates were not applied directly',
        templateSchemaRetrievalInsufficient:
          'Schema retrieval was insufficient, so the template was not applied directly',
        trustedReferenceSelected: 'Matched a trusted SQL reference',
      },
      sqlSources: {
        generated: 'LLM reference generation',
        directGenerated: 'Direct LLM generation',
        anchoredGenerated: 'Constraint-guided template generation',
        anchoredTemplate: 'Direct anchored-template reuse',
        renderedTemplate: 'Direct rendered template execution',
        corrected: 'Corrected SQL',
      },
    },
    chart: {
      badge: 'Chart follow-up',
      teaserTitle: 'Chart',
      statuses: {
        generated: 'Generated',
        failed: 'Failed',
        generating: 'Generating',
        enhance: 'Enhance',
      },
      descriptions: {
        followUpReady:
          'The chart is ready. Open it in the workbench to continue.',
        followUpGenerating: 'Generating a chart from the current result.',
        askReady:
          'A chart result already exists. Open it directly in the workbench.',
        askFailed: 'Chart generation failed. You can try again.',
        askGenerating: 'Generating a chart from the current result.',
        askCreate: 'Generate a chart from the current result.',
        noChartFallback: 'Chart generation failed. Please try again.',
      },
      actions: {
        view: 'View chart',
        regenerate: 'Regenerate',
        generating: 'Generating',
        unavailable: 'Unavailable',
        create: 'Generate chart',
      },
      alerts: {
        failedShort: 'Chart generation failed',
      },
      syntheticQuestion: 'Generate chart',
    },
    recommendation: {
      badge: 'Recommendations',
      triggerLabel: 'Recommend follow-up questions',
      sectionTitle: 'Recommended follow-ups',
      sectionIntro: 'Based on this result, you could ask next:',
      alerts: {
        failedShort: 'Recommendation generation failed',
      },
      actions: {
        retry: 'Retry',
      },
      notifications: {
        sourceNotReady:
          'The current answer is not ready yet. Please try again.',
        generateFailed: "Couldn't generate recommendations. Please try again.",
      },
      categories: {
        drillDown: 'Drill down',
        compare: 'Compare',
        trend: 'Trend',
        distribution: 'Distribution',
        ranking: 'Ranking',
        chartFollowUp: 'Make chart',
        chartRefine: 'Refine chart',
        relatedQuestion: 'Related',
      },
    },
  },
};

const DEFAULT_THREAD_WORKBENCH_LOCALE: ThreadWorkbenchLocale = 'zh-CN';

export const resolveThreadWorkbenchLocale = (
  locale?: string | null,
): ThreadWorkbenchLocale => {
  const normalizedLocale = (locale || '').trim().toLowerCase();
  if (!normalizedLocale) {
    return DEFAULT_THREAD_WORKBENCH_LOCALE;
  }

  if (normalizedLocale.startsWith('en')) {
    return 'en-US';
  }

  if (normalizedLocale.startsWith('zh')) {
    return 'zh-CN';
  }

  return DEFAULT_THREAD_WORKBENCH_LOCALE;
};

export const getThreadWorkbenchMessages = (locale?: string | null) =>
  THREAD_WORKBENCH_MESSAGE_CATALOG[resolveThreadWorkbenchLocale(locale)];

export const useThreadWorkbenchMessages = (locale?: string | null) => {
  const [resolvedLocale, setResolvedLocale] = useState<ThreadWorkbenchLocale>(
    resolveThreadWorkbenchLocale(locale),
  );

  useEffect(() => {
    setResolvedLocale(resolveThreadWorkbenchLocale(locale));
  }, [locale]);

  return useMemo(
    () => THREAD_WORKBENCH_MESSAGE_CATALOG[resolvedLocale],
    [resolvedLocale],
  );
};
