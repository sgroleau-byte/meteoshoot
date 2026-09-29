import { registerPlugin } from '@capacitor/core';
import { isNative, platform } from './platform.js';

// Pont vers le widget iPhone (ios/App/App/WidgetBridgePlugin.swift): l'app dépose un instantané JSON du
// shooting du jour dans le groupe d'apps partagé, le widget le lit et se rafraîchit. Sans effet ailleurs.
const WidgetBridge = registerPlugin('WidgetBridge');
const active = isNative && platform === 'ios';

export const pushWidgetSnapshot = (snapshot) => {
  if (!active) return;
  WidgetBridge.setData({ json: JSON.stringify(snapshot) }).catch(() => {});
};

export const clearWidgetSnapshot = () => {
  if (!active) return;
  WidgetBridge.clearData().catch(() => {});
};
