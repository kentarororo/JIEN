import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

type ScreenData<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
};

export function useScreenData<T>(loader: () => Promise<T>): ScreenData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const nextData = await loader();
      if (generation === requestGeneration.current) setData(nextData);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : 'Something went wrong.');
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [loader]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => { requestGeneration.current += 1; };
    }, [reload]),
  );

  return { data, error, loading, reload };
}
