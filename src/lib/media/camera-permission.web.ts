import { Camera, type PermissionResponse } from 'expo-camera';
import { useCallback, useState } from 'react';

export function useJienCameraPermissions(): [
  PermissionResponse | null,
  () => Promise<PermissionResponse>,
] {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const requestPermission = useCallback(async () => {
    // Safari does not expose camera through Permissions.query. A user-initiated
    // getUserMedia request is the interoperable permission path.
    const next = await Camera.requestCameraPermissionsAsync();
    setPermission(next);
    return next;
  }, []);
  return [permission, requestPermission];
}
