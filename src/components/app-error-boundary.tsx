import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

type State = { error: Error | null };

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled application error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.card}>
          <Text style={styles.title}>JIEN couldn’t start</Text>
          <Text style={styles.body}>Your local data has not been removed. Close and reopen the app, then try again.</Text>
          {__DEV__ ? <Text selectable style={styles.detail}>{this.state.error.message}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F1E7', padding: 20, justifyContent: 'center' },
  card: { backgroundColor: '#FFFBF5', borderRadius: 16, padding: 20, gap: 12 },
  title: { color: '#2B211B', fontSize: 22, lineHeight: 28, fontWeight: '700' },
  body: { color: '#6E6056', fontSize: 16, lineHeight: 24 },
  detail: { color: '#9D493C', fontSize: 12, lineHeight: 16 },
});
