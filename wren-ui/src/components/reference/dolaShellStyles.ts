import { Layout } from 'antd';
import styled from 'styled-components';

const { Sider, Content } = Layout;

export const Shell = styled(Layout)`
  min-height: 100vh;
  background: #ffffff;
`;

export const Sidebar = styled(Sider)`
  && {
    --dola-shell-sidebar-inline-pad: 2px;
    position: sticky;
    top: 0;
    align-self: flex-start;
    height: 100vh;
    background: #fbfcfe;
    border-right: 1px solid #e8edf4;
    padding: 10px 8px 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    .ant-layout-sider-children {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      gap: 8px;
    }

    .ant-menu {
      background: transparent;
      border: 0;
    }

    .ant-menu-inline > .ant-menu-item,
    .ant-menu-inline > .ant-menu-submenu > .ant-menu-submenu-title {
      width: 100%;
      height: 32px;
      line-height: 32px;
      margin: 0;
      padding-inline: 9px !important;
      border-radius: var(--nova-radius-control);
      color: #4b5563;
      font-size: 13px;
      font-weight: 500;
      transition:
        background 0.18s ease,
        color 0.18s ease;
    }

    .ant-menu-inline > .ant-menu-item .ant-menu-item-icon,
    .ant-menu-inline
      > .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-item-icon {
      color: #5f6b7a;
      font-size: 14px;
      transition: color 0.18s ease;
    }

    .ant-menu-inline > .ant-menu-item .ant-menu-title-content {
      min-width: 0;
    }

    .ant-menu-inline > .ant-menu-item:hover,
    .ant-menu-inline > .ant-menu-submenu > .ant-menu-submenu-title:hover {
      background: rgba(123, 87, 232, 0.045);
      color: #3f3277;
    }

    .ant-menu-inline > .ant-menu-item:hover .ant-menu-item-icon,
    .ant-menu-inline
      > .ant-menu-submenu
      > .ant-menu-submenu-title:hover
      .ant-menu-item-icon {
      color: #5b45c8;
    }

    .ant-menu-inline > .ant-menu-item-selected {
      background: rgba(123, 87, 232, 0.075);
      color: #5b45c8;
      box-shadow: inset 0 0 0 1px rgba(123, 87, 232, 0.18);
      font-weight: 600;
    }

    .ant-menu-inline > .ant-menu-item-selected .ant-menu-item-icon {
      color: #5b45c8;
    }

    .ant-menu-inline-collapsed > .ant-menu-item,
    .ant-menu-inline-collapsed > .ant-menu-submenu > .ant-menu-submenu-title {
      padding-inline: calc(50% - 8px) !important;
    }

    .ant-menu-item-group {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #f1f3f7;
    }

    .ant-menu-item-group:first-of-type {
      margin-top: 2px;
      padding-top: 0;
      border-top: 0;
    }

    .ant-menu-item-group-title {
      padding: 3px 10px 5px !important;
      color: #8b93a7 !important;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .ant-menu-item-group-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ant-menu-item-group-list .ant-menu-item,
    .ant-menu-item-group-list .ant-menu-submenu > .ant-menu-submenu-title {
      width: 100%;
      min-height: 31px;
      height: 31px;
      line-height: 31px;
      margin: 0;
      padding-inline: 8px !important;
      border-radius: var(--nova-radius-control);
      color: #4b5563;
      font-size: 13px;
      font-weight: 500;
      transition:
        background 0.18s ease,
        color 0.18s ease;
    }

    .ant-menu-item-group-list .ant-menu-item .ant-menu-title-content,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-title-content {
      min-width: 0;
    }

    .ant-menu-item-group-list .ant-menu-item:hover,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title:hover {
      background: rgba(123, 87, 232, 0.045);
      color: #3f3277;
    }

    .ant-menu-item-group-list .ant-menu-item-selected {
      background: rgba(123, 87, 232, 0.075);
      color: #5b45c8;
      box-shadow: inset 0 0 0 1px rgba(123, 87, 232, 0.18);
      font-weight: 600;
    }

    .ant-menu-item-group-list .ant-menu-item .ant-menu-item-icon,
    .ant-menu-item-group-list
      .ant-menu-submenu
      > .ant-menu-submenu-title
      .ant-menu-item-icon {
      font-size: 13px;
    }

    &.ant-layout-sider-collapsed {
      padding: 10px 6px 0;
    }

    @media (max-width: 1120px) {
      position: static;
      align-self: stretch;
      height: auto;
      max-width: 100% !important;
      min-width: 100% !important;
      width: 100% !important;
      border-right: 0;
      border-bottom: 1px solid #e5e7eb;
    }
  }
`;

export const Main = styled(Content)<{
  $flush?: boolean;
  $flushBottom?: boolean;
  $stretchContent?: boolean;
  $paddingTop?: string;
}>`
  ${(props) => {
    const resolvePadding = (mobile = false) => {
      if (props.$flush) {
        return '0';
      }

      const top = props.$paddingTop || (mobile ? '16px' : '24px');
      const bottom = props.$flushBottom ? '0' : mobile ? '16px' : '24px';

      return mobile ? `${top} 16px ${bottom}` : `${top} 24px ${bottom} 4px`;
    };

    return `
      padding: ${resolvePadding()};

      @media (max-width: 1120px) {
        padding: ${resolvePadding(true)};
      }
    `;
  }}
  min-width: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: ${(props) => (props.$stretchContent ? 'hidden' : 'auto')};
  scrollbar-gutter: ${(props) =>
    props.$stretchContent ? 'auto' : 'stable both-edges'};
  background: #ffffff;

  @media (max-width: 1120px) {
    height: auto;
    overflow: auto;
    scrollbar-gutter: auto;
  }
`;

export const MainInner = styled.div`
  min-height: 100%;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

export const MainTopbar = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  flex-wrap: wrap;
`;
