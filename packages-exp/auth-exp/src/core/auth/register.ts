/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { _registerComponent, registerVersion } from '@firebase/app-exp';
import { Component, ComponentType } from '@firebase/component';

import { version } from '../../../package.json';
import { AuthErrorCode } from '../errors';
import { _assert } from '../util/assert';
import { _getClientVersion, ClientPlatform } from '../util/version';
import { _castAuth, AuthImpl, DefaultConfig } from './auth_impl';
import { AuthInterop } from './firebase_internal';
import { ConfigInternal } from '../../model/auth';
import { Dependencies } from '../../model/public_types';
import { _initializeAuthInstance } from './initialize';

export const enum _ComponentName {
  AUTH = 'auth-exp',
  AUTH_INTERNAL = 'auth-internal'
}

function getVersionForPlatform(
  clientPlatform: ClientPlatform
): string | undefined {
  switch (clientPlatform) {
    case ClientPlatform.NODE:
      return 'node';
    case ClientPlatform.REACT_NATIVE:
      return 'rn';
    case ClientPlatform.WORKER:
      return 'webworker';
    case ClientPlatform.CORDOVA:
      return 'cordova';
    default:
      return undefined;
  }
}

/** @internal */
export function registerAuth(clientPlatform: ClientPlatform): void {
  _registerComponent(
    new Component(
      _ComponentName.AUTH,
      (container, { options: deps }: { options?: Dependencies }) => {
        const app = container.getProvider('app-exp').getImmediate()!;
        const { apiKey, authDomain } = app.options;
        return (app => {
          _assert(apiKey, AuthErrorCode.INVALID_API_KEY, { appName: app.name });
          const config: ConfigInternal = {
            apiKey,
            authDomain,
            clientPlatform,
            apiHost: DefaultConfig.API_HOST,
            tokenApiHost: DefaultConfig.TOKEN_API_HOST,
            apiScheme: DefaultConfig.API_SCHEME,
            sdkClientVersion: _getClientVersion(clientPlatform)
          };

          const authInstance = new AuthImpl(app, config);
          _initializeAuthInstance(authInstance, deps);

          return authInstance;
        })(app);
      },
      ComponentType.PUBLIC
    )
  );

  _registerComponent(
    new Component(
      _ComponentName.AUTH_INTERNAL,
      container => {
        const auth = _castAuth(
          container.getProvider(_ComponentName.AUTH).getImmediate()!
        );
        return (auth => new AuthInterop(auth))(auth);
      },
      ComponentType.PRIVATE
    )
  );

  registerVersion(
    _ComponentName.AUTH,
    version,
    getVersionForPlatform(clientPlatform)
  );
}
