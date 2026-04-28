import { Dropdown, Menu } from 'antd';
import type { MenuProps } from 'antd';
import LogoutOutlined from '@ant-design/icons/LogoutOutlined';
import SettingOutlined from '@ant-design/icons/SettingOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import styled from 'styled-components';

type Props = {
  collapsed: boolean;
  selectedKeys: string[];
  footerMenuItems: NonNullable<MenuProps['items']>;
  onAccountMenuClick: NonNullable<MenuProps['onClick']>;
  loggingOut: boolean;
  authLoading: boolean;
  accountAvatar: string;
  accountDisplayName: string;
};

const FooterNavSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const FooterControlCluster = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${(props) => (props.$collapsed ? '5px' : '6px')};
`;

const Footer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 var(--dola-shell-sidebar-inline-pad) 7px;
`;

const AccountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
`;

const AccountAvatar = styled.div`
  width: 25px;
  height: 25px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(79, 70, 229, 0.08);
  color: #4338ca;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
`;

const AccountName = styled.div`
  min-width: 0;
  color: #111827;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const AccountButton = styled.button<{ $collapsed?: boolean }>`
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: transparent;
  min-height: ${(props) => (props.$collapsed ? '31px' : '36px')};
  display: inline-flex;
  align-items: center;
  justify-content: ${(props) =>
    props.$collapsed ? 'center' : 'space-between'};
  gap: 8px;
  padding: ${(props) => (props.$collapsed ? '3px 0' : '5px 7px')};
  cursor: pointer;
  color: #374151;
  transition:
    background 0.18s ease,
    color 0.18s ease;

  &:hover,
  &:focus-visible {
    outline: none;
    background: rgba(248, 250, 252, 0.86);
    color: #111827;
  }
`;

export default function DolaShellFooterPanel({
  collapsed,
  selectedKeys,
  footerMenuItems,
  onAccountMenuClick,
  loggingOut,
  authLoading,
  accountAvatar,
  accountDisplayName,
}: Props) {
  const accountMenuItems: MenuProps['items'] = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: loggingOut ? '退出中…' : '退出登录',
    },
  ];

  return (
    <Footer>
      <FooterControlCluster $collapsed={collapsed}>
        {footerMenuItems.length > 0 ? (
          <FooterNavSection>
            <Menu
              mode="inline"
              selectedKeys={selectedKeys}
              items={footerMenuItems}
            />
          </FooterNavSection>
        ) : null}
        <Dropdown
          menu={{
            items: accountMenuItems,
            onClick: onAccountMenuClick,
          }}
          trigger={['click']}
          placement="topLeft"
        >
          <AccountButton
            type="button"
            $collapsed={collapsed}
            aria-label="账户菜单"
          >
            <AccountRow>
              <AccountAvatar>
                {authLoading ? <UserOutlined /> : accountAvatar}
              </AccountAvatar>
              {!collapsed ? (
                <AccountName>
                  {authLoading ? '正在验证身份…' : accountDisplayName}
                </AccountName>
              ) : null}
            </AccountRow>
            {!collapsed ? (
              <DownOutlined style={{ color: '#a8b0bc', fontSize: 10.5 }} />
            ) : null}
          </AccountButton>
        </Dropdown>
      </FooterControlCluster>
    </Footer>
  );
}
