import React from 'react';
import { registerRootComponent } from 'expo';

import './global.css';
import { evaluateEnvironment } from './Firebase/env/gate';

// The environment is checked BEFORE the app (and therefore before any Firebase code) is loaded. On any mismatch the app does not start:
// an error screen is shown and no network call is made. Nothing is defaulted; see Firebase/env/validate.js.
const gate = evaluateEnvironment();
if (gate.ok) {
  // registerRootComponent calls AppRegistry.registerComponent('main', () => App);
  // It also ensures that whether you load the app in Expo Go or in a native build,
  // the environment is set up appropriately
  registerRootComponent(require('./App').default);
} else {
  const EnvironmentError = require('./components/EnvironmentError').default;
  registerRootComponent(() => React.createElement(EnvironmentError, { problems: gate.problems }));
}
