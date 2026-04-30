import {
  ALL_CONNECTOR_TYPE_OPTIONS,
  CONNECTOR_TYPE_OPTIONS,
} from './connectorsPageUtils';

type BuildManageConnectorsControlStateArgs = {
  createConnectorBlockedReason?: string | null;
  editingConnector?: unknown;
  submitting: boolean;
  updateConnectorBlockedReason?: string | null;
  watchedConnectorType?: string;
};

const resolveConnectorTypeOptions = (editingConnector?: unknown) => {
  const editingConnectorType =
    editingConnector && typeof editingConnector === 'object'
      ? (editingConnector as { type?: string | null }).type
      : null;

  if (
    !editingConnectorType ||
    CONNECTOR_TYPE_OPTIONS.some(
      (option) => option.value === editingConnectorType,
    )
  ) {
    return CONNECTOR_TYPE_OPTIONS;
  }

  const legacyOption = ALL_CONNECTOR_TYPE_OPTIONS.find(
    (option) => option.value === editingConnectorType,
  );
  return legacyOption
    ? [...CONNECTOR_TYPE_OPTIONS, legacyOption]
    : CONNECTOR_TYPE_OPTIONS;
};

export function buildManageConnectorsControlState({
  createConnectorBlockedReason,
  editingConnector,
  submitting,
  updateConnectorBlockedReason,
  watchedConnectorType,
}: BuildManageConnectorsControlStateArgs) {
  return {
    connectorTypeOptions: resolveConnectorTypeOptions(editingConnector),
    modalTestDisabled:
      Boolean(updateConnectorBlockedReason) ||
      submitting ||
      watchedConnectorType !== 'database',
    modalSubmitDisabled: Boolean(
      editingConnector
        ? updateConnectorBlockedReason
        : createConnectorBlockedReason,
    ),
  };
}

export default buildManageConnectorsControlState;
