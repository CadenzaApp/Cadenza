require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AppleMusicKit'
  s.version        = package['version']
  s.summary        = 'Apple MusicKit Expo Module'
  s.license        = { :type => 'MIT' }
  s.author         = { 'Cadenza' => 'cadenza@placeholder.com' }
  s.homepage       = 'https://github.com/placeholder'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MusicKit', 'StoreKit'

  s.source_files = 'ios/**/*.{h,m,mm,swift,hpp,cpp}'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
