import { useCallback, useEffect, useMemo, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import useRuntimeScopeNavigation from './useRuntimeScopeNavigation';
import {
  deleteThreadResponseFeedback,
  getThreadResponseFeedback,
  upsertThreadResponseFeedback,
  type ThreadResponseFeedbackData,
  type ThreadResponseFeedbackPayload,
  type ThreadResponseFeedbackReason,
} from '@/utils/threadResponseFeedbackRest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

type UseThreadResponseFeedbackOptions = {
  disabled?: boolean;
};

export default function useThreadResponseFeedback(
  responseId: number,
  options?: UseThreadResponseFeedbackOptions,
) {
  const disabled = Boolean(options?.disabled);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [feedback, setFeedback] = useState<ThreadResponseFeedbackData | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selector = runtimeScopeNavigation.selector;
  const canRequest =
    !disabled && responseId > 0 && runtimeScopeNavigation.hasRuntimeScope;

  const loadFeedback = useCallback(async () => {
    if (!canRequest) {
      setFeedback(null);
      return null;
    }

    setLoading(true);
    try {
      const payload = await getThreadResponseFeedback({
        responseId,
        selector,
      });
      setFeedback(payload.feedback);
      return payload.feedback;
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载问数结果反馈失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [canRequest, responseId, selector]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  const submitFeedback = useCallback(
    async (payload: ThreadResponseFeedbackPayload) => {
      if (!canRequest || submitting) {
        return null;
      }

      setSubmitting(true);
      try {
        const result = await upsertThreadResponseFeedback({
          responseId,
          selector,
          payload,
        });
        setFeedback(result.feedback);
        message.success(
          payload.rating === 'positive' ? '感谢反馈' : '已记录反馈',
        );
        return result.feedback;
      } catch (error) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '保存问数结果反馈失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [canRequest, responseId, selector, submitting],
  );

  const deleteFeedback = useCallback(async () => {
    if (!canRequest || submitting) {
      return false;
    }

    setSubmitting(true);
    try {
      await deleteThreadResponseFeedback({
        responseId,
        selector,
      });
      setFeedback(null);
      message.success('已撤销反馈');
      return true;
    } catch (error) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '撤销问数结果反馈失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [canRequest, responseId, selector, submitting]);

  const submitPositiveFeedback = useCallback(async () => {
    if (feedback?.rating === 'positive') {
      return deleteFeedback();
    }

    return submitFeedback({
      rating: 'positive',
      reasonCodes: [],
      comment: null,
    });
  }, [deleteFeedback, feedback?.rating, submitFeedback]);

  const submitNegativeFeedback = useCallback(
    async ({
      reasonCodes,
      comment,
    }: {
      reasonCodes: ThreadResponseFeedbackReason[];
      comment?: string | null;
    }) =>
      submitFeedback({
        rating: 'negative',
        reasonCodes,
        comment,
      }),
    [submitFeedback],
  );

  return useMemo(
    () => ({
      feedback,
      loading,
      submitting,
      submitPositiveFeedback,
      submitNegativeFeedback,
      deleteFeedback,
      refetch: loadFeedback,
    }),
    [
      deleteFeedback,
      feedback,
      loadFeedback,
      loading,
      submitNegativeFeedback,
      submitPositiveFeedback,
      submitting,
    ],
  );
}
