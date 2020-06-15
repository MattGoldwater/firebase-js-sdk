/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as tmp from 'tmp';
import * as path from 'path';
import * as fs from 'fs';
import * as rollup from 'rollup';
import * as terser from 'terser';
import * as ts from 'typescript';

/** Contains a list of members by type. */
export type MemberList = {
  classes: string[];
  functions: string[];
  variables: string[];
  enums: string[];
};
/** Contains the dependencies and the size of their code for a single export. */
export type ExportData = { dependencies: MemberList; sizeInBytes: number };

/**
 * This functions builds a simple JS app that only depends on the provided
 * export. It then uses Rollup to gather all top-level classes and functions
 * that that the export depends on.
 *
 * @param exportName The name of the export to verify
 * @param jsBundle The file name of the source bundle that contains the export
 * @return A list of dependencies for the given export
 */
export async function extractDependencies(
  exportName: string,
  jsBundle: string
): Promise<MemberList> {
  const { dependencies } = await extractDependenciesAndSize(
    exportName,
    jsBundle
  );
  return dependencies;
}

/**
 * Helper for extractDependencies that extracts the dependencies and the size
 * of the minified build.
 */
export async function extractDependenciesAndSize(
  exportName: string,
  jsBundle: string
): Promise<ExportData> {
  const input = tmp.fileSync().name + '.js';
  const output = tmp.fileSync().name + '.js';

  const beforeContent = `export { ${exportName} } from '${path.resolve(
    jsBundle
  )}';`;
  fs.writeFileSync(input, beforeContent);

  // Run Rollup on the JavaScript above to produce a tree-shaken build
  const bundle = await rollup.rollup({
    input,
    external: id => id.startsWith('@firebase-exp/')
  });
  await bundle.write({ file: output, format: 'es' });

  const dependencies = extractDeclarations(output);

  // Extract size of minified build
  const afterContent = fs.readFileSync(output, 'utf-8');
  const { code } = terser.minify(afterContent, {
    output: {
      comments: false
    },
    mangle: false,
    compress: false
  });

  fs.unlinkSync(input);
  fs.unlinkSync(output);
  return { dependencies, sizeInBytes: Buffer.byteLength(code!, 'utf-8') };
}

/**
 * Extracts all function, class and variable declarations using the TypeScript
 * compiler API.
 */
export function extractDeclarations(jsFile: string): MemberList {
  const program = ts.createProgram([jsFile], { allowJs: true });

  const sourceFile = program.getSourceFile(jsFile);
  if (!sourceFile) {
    throw new Error('Failed to parse file: ' + jsFile);
  }

  const declarations: MemberList = {
    functions: [],
    classes: [],
    variables: [],
    enums: []
  };

  ts.forEachChild(sourceFile, node => {
    console.log(node.kind);
    if (ts.isFunctionDeclaration(node)) {
      declarations.functions.push(node.name!.text);
    } else if (ts.isClassDeclaration(node)) {
      declarations.classes.push(node.name!.text);
    } else if (ts.isVariableDeclaration(node)) {
      declarations.variables.push(node.name!.getText());
    } else if (ts.isEnumDeclaration(node)) {
      declarations.enums.push(node.name.escapedText.toString());
    } else if (ts.isVariableStatement(node)) {
      const variableDeclarations = node.declarationList.declarations;
      variableDeclarations.forEach(variableDeclaration => {
        if (ts.isIdentifier(variableDeclaration.name)) {
          declarations.variables.push(
            (variableDeclaration.name as ts.Identifier).escapedText as string
          );
        }
        // TODO: variableDeclaration.name is an union type (Identifier | BindingPattern)
        // need Identifier type, not sure in what case BindingPattern type is for.
        else {
          console.log(
            'this VariableDeclaration.name object is of BindingPattern type !'
          );
        }
      });
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const fileName: string = node.moduleSpecifier.text;
        const reExportPath = `${jsFile.substring(
          0,
          jsFile.lastIndexOf('/') + 1
        )}${fileName}.d.ts`;
        const reExportsMember = extractDeclarations(path.resolve(reExportPath));
        // for Named Exports : filter the reExportsMember to keep only the symbols
        // declared for re-export.

        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          node.exportClause.elements.forEach(exportSpecifier => {
            const reExportedSymbol: string = exportSpecifier.name.escapedText.toString();
            reExportsMember.functions = reExportsMember.functions.filter(each =>
              isReExported(each, reExportedSymbol)
            );
            reExportsMember.variables = reExportsMember.variables.filter(each =>
              isReExported(each, reExportedSymbol)
            );
            reExportsMember.classes = reExportsMember.classes.filter(each =>
              isReExported(each, reExportedSymbol)
            );
            reExportsMember.enums = reExportsMember.enums.filter(each =>
              isReExported(each, reExportedSymbol)
            );
          });
        }
        // concatename reExport MemberList with MemberList of the dts file
        declarations.functions.push(...reExportsMember.functions);
        declarations.variables.push(...reExportsMember.variables);
        declarations.classes.push(...reExportsMember.classes);
        declarations.enums.push(...reExportsMember.classes);
      }
    }
  });

  // Sort to ensure stable output
  declarations.functions.sort();
  declarations.classes.sort();
  declarations.variables.sort();
  declarations.enums.sort();

  return declarations;
}

function isReExported(symbol: string, reExportedSymbol: string): boolean {
  return symbol.localeCompare(reExportedSymbol) == 0;
}