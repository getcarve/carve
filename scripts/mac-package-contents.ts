/** Only runtime files belong in the desktop archive.
 * Only the dependency-free shared price module is admitted from gateway output.
 * The separately deployed gateway and any future project-root secrets stay out. */
export const macPackageIgnore = [
  '^/(?!(?:dist|node_modules)(?:$|/)|package\\.json$).+',
  '^/dist/(?!(?:desktop|src|ui|gateway)(?:$|/)).+',
  '^/dist/gateway/(?!src(?:$|/)).+',
  '^/dist/gateway/src/(?!provider-cost\\.js$).+',
  '/\\.env(?:$|[./])',
]
