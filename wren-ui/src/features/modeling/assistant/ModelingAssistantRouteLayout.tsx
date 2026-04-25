import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';

export default function ModelingAssistantRouteLayout({
  title,
  description,
  onBack,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <ConsoleShellLayout
      activeNav="knowledge"
      navItems={[]}
      eyebrow="建模 AI 助手"
      title={title}
      description={description}
      hideHistorySection
      hideSidebarBranding
      hideSidebarFooterPanel
      hideSidebarCollapseToggle
      titleExtra={
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回建模
        </Button>
      }
    >
      {children}
    </ConsoleShellLayout>
  );
}
