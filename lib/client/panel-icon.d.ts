/**
 * 侧栏图标。
 *
 * 只画形状,颜色一律 `currentColor`,因此明暗主题与选中态都由宿主决定,
 * 本插件不写死任何色值。
 */
import { type ReactElement } from 'react';
/** `sidebar.panellist` 的 ownerProps,由全局面板行提供。 */
export interface SerialPanelIconProps {
    /** 请求的方形边长(像素)。 */
    readonly size: number;
    /** 该面板是否在主列中被选中。 */
    readonly active: boolean;
}
/**
 * 侧栏面板图标。继承宿主文字颜色,随选中状态调整不透明度。
 *
 * @param props 宿主提供的尺寸与选中状态。
 * @returns 内联 SVG 图标元素。
 */
export declare function SerialPanelIcon(props: SerialPanelIconProps): ReactElement;
