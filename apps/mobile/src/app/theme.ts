export type AppTheme = {
  background: string;
  card: string;
  cardBorder: string;
  heading: string;
  subtext: string;
  inputBg: string;
  inputText: string;
  inputPlaceholder: string;
  primary: string;
  primaryMuted: string;
  danger: string;
  dangerMuted: string;
  pillBg: string;
  pillActive: string;
  pillText: string;
};

export const darkTheme: AppTheme = {
  background: '#071F2F',
  card: '#0C2A40',
  cardBorder: '#1B4668',
  heading: '#F4F8FF',
  subtext: '#B0C0D0',
  inputBg: '#12344D',
  inputText: '#F4F8FF',
  inputPlaceholder: '#7E94AB',
  primary: '#2D9CDB',
  primaryMuted: '#315B79',
  danger: '#A74962',
  dangerMuted: '#6D3B4A',
  pillBg: '#15364E',
  pillActive: '#2D9CDB',
  pillText: '#EAF4FF'
};

export const lightTheme: AppTheme = {
  background: '#F3F7FB',
  card: '#FFFFFF',
  cardBorder: '#D9E4EF',
  heading: '#11283A',
  subtext: '#4B667B',
  inputBg: '#F2F6FA',
  inputText: '#102A3D',
  inputPlaceholder: '#7A91A7',
  primary: '#1976D2',
  primaryMuted: '#8CB6DF',
  danger: '#B93E5F',
  dangerMuted: '#D9A8B5',
  pillBg: '#E5EEF6',
  pillActive: '#1976D2',
  pillText: '#17344C'
};
