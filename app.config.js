const appJson = require('./app.json');

module.exports = () => {
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL;

  return {
    ...appJson.expo,
    name: 'JIEN',
    icon: './assets/app-icon.png',
    android: {
      ...appJson.expo.android,
      package: 'com.kentarororo.jien',
      icon: './assets/app-icon.png',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#71452F',
      },
    },
    experiments: {
      ...appJson.expo.experiments,
      ...(baseUrl ? { baseUrl } : {}),
    },
  };
};
