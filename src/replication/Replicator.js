const fs = require('fs')
const path = require('path')
const PipelineData = require('./PipelineData')

class Replicator {
  constructor(replicationRecipe, toolbox) {
    this.replicationRecipe = replicationRecipe
    this.replicationDirectory = path.join(replicationRecipe.templateDir, 'new') // TODO inject via constructor
    this.toolbox = toolbox

    const binaryFilesDescriptorPath = path.join(
      replicationRecipe.templateDir,
      'files.json'
    )
    this.pipelineData = new PipelineData(binaryFilesDescriptorPath, toolbox)
  }

  async processRecipeFiles(sampleDirectory) {
    await this._processFilesInDirectoryRecursive(
      sampleDirectory,
      sampleDirectory
    )

    this.pipelineData.saveToDisk()
  }

  async _processFilesInDirectoryRecursive(currentPath, rootPath) {
    console.log('Processing directory', currentPath)

    const files = fs.readdirSync(currentPath)
    for (let i = 0; i < files.length; i = i + 1) {
      const file = files[i]
      const fullPath = path.join(currentPath, file)

      if (this.replicationRecipe.ignoreArtifacts.indexOf(file) > -1) {
        continue
      }

      if (fs.lstatSync(fullPath).isFile()) {
        const relativePath = path.relative(rootPath, fullPath)
        const middlePath = relativePath.replace(path.basename(relativePath), '')
        const virtualPath = path
          .join(middlePath, file)
          .replace(/\\/g, '-')
          .replace(/\//g, '-')
        const destinationPath = path.join(
          this.replicationDirectory,
          virtualPath
        )

        if (this.toolbox.isBinaryFile(fullPath))
          await this._justCopy(fullPath, destinationPath, relativePath)
        else await this._toTemplate(fullPath, destinationPath, relativePath)

        continue
      }

      await this._processFilesInDirectoryRecursive(fullPath, rootPath)
    }
  }

  async _toTemplate(src, dest, relativePath) {
    const { copyFile } = this.toolbox
    const fullPathSrc = path.resolve(src)
    const fullPathDest = path.resolve(`${dest}.ejs.t`)
    console.log(`Generating template from ${fullPathSrc} to ${fullPathDest}`)

    copyFile(fullPathSrc, fullPathDest) // merge two parts

    let targetPath = relativePath.replace(/\\/g, '/')
    targetPath = this._replaceTermsInText(
      targetPath,
      this.replicationRecipe.fileNameReplacements
    )

    let calculatedTargetPath = this._calculateTargetPath(relativePath)
    let frontmatter = ['---', `to: "${calculatedTargetPath}"`, '---']

    await this._prepareFiles(
      fullPathDest,
      frontmatter,
      this.replicationRecipe.sourceCodeReplacements
    )
  }

  _calculateTargetPath(relativePath) {
    let targetPath = relativePath.replace(/\\/g, '/')
    targetPath = this._replaceTermsInText(
      targetPath,
      this.replicationRecipe.fileNameReplacements
    )

    let delimiters = this.replicationRecipe.delimiters
    return `${delimiters[0]} name ${delimiters[1]}/${targetPath}`
  }

  _replaceTermsInText(text, replacements) {
    replacements.forEach(replacement => {
      const { from, to } = replacement
      text = text.split(from).join(to)
    })
    return text
  }

  async _prepareFiles(filePath, metadataLines, sourceCodeReplacements) {
    const { readFile, writeFile, prependToFileAsync } = this.toolbox

    // refactor to avoid three operations on the same file
    const originalContent = readFile(filePath)
    let adjustedContent = this._replaceTermsInText(
      originalContent,
      sourceCodeReplacements
    )
    writeFile(filePath, adjustedContent)

    let contentToPrepend = metadataLines
      .map(line => {
        return line
        // return this._replaceTermsInText(line, sourceCodeReplacements) // why?
      })
      .join('\n')
    await prependToFileAsync(filePath, `${contentToPrepend}\n`)
  }

  async _justCopy(src, dest, relativePath) {
    const { copyFile } = this.toolbox

    const fullSourcePath = path.resolve(src)
    const fullDestinationPath = path.resolve(dest)
    copyFile(fullSourcePath, fullDestinationPath)

    const calculatedTargetPath = this._calculateTargetPath(relativePath)
    this.pipelineData.pushBinaryFile(fullDestinationPath, calculatedTargetPath)
  }
}

module.exports = Replicator
