/**
 * 侧栏图标。
 *
 * 只画形状,颜色一律 `currentColor`,因此明暗主题与选中态都由宿主决定,
 * 本插件不写死任何色值。
 */
import { createElement } from 'react';
/**
 * 侧栏面板图标。继承宿主文字颜色,随选中状态调整不透明度。
 *
 * @param props 宿主提供的尺寸与选中状态。
 * @returns 内联 SVG 图标元素。
 */
export function SerialPanelIcon(props) {
    return createElement('svg', {
        width: props.size,
        height: props.size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block', opacity: props.active ? 1 : 0.72 },
    }, createElement('path', { d: 'M4 5.5h6.2v13H4z' }), createElement('path', { d: 'M13.8 5.5H20v8.4h-6.2z' }), createElement('path', { d: 'M13.8 16.4H20v2.1h-6.2z' }));
}
