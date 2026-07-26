import { Image } from 'react-native'
import { colors } from '../theme/mobile-theme'

type Props = {
  size?: number
  color?: string
}

export function OrcaLogo({ size = 24, color: _color = colors.textPrimary }: Props) {
  return (
    <Image
      source={require('../../../assets/dev10x-icon.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Dev10x"
    />
  )
}
