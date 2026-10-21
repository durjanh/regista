# Strict YAML check for CI: parses every file and fails on duplicate mapping keys, which Ruby's YAML.load
# (and many parsers) accept silently but azd rejects ("mapping key ... already defined").
require "yaml"

def dupes(node, file, errors)
  if node.is_a?(Psych::Nodes::Mapping)
    seen = {}
    node.children.each_slice(2) do |k, _v|
      next unless k.is_a?(Psych::Nodes::Scalar)
      errors << "#{file}:#{k.start_line + 1}: duplicate key '#{k.value}'" if seen[k.value]
      seen[k.value] = true
    end
  end
  (node.children || []).each { |c| dupes(c, file, errors) }
end

errors = []
ARGV.each do |f|
  Psych.parse_stream(File.read(f)).children.each { |doc| dupes(doc, f, errors) }
rescue Psych::SyntaxError => e
  errors << "#{f}: #{e.message}"
end
abort(errors.join("\n")) unless errors.empty?
puts "#{ARGV.size} YAML files: ok"
