Pod::Spec.new do |s|
  s.name           = 'ImageColorModule'
  s.version        = '0.1.0'
  s.summary        = 'Average color of a remote image'
  s.description    = 'An Expo module that downloads an image and returns its average color as a hex string.'
  s.author         = 'Cadenza'
  s.homepage       = 'https://capstone.cs.utah.edu/cadenza/cadenza'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => 'https://capstone.cs.utah.edu/cadenza/cadenza.git', :tag => s.version.to_s }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
