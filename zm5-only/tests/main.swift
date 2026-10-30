import Foundation

let source = Data([70,87,83,17,10,0,0,0,1,2])
let target = Data([70,87,83,17,11,0,0,0,1,2,3])
let value: [String: Any] = ["sourceHash": PatchRecipe.hash(source), "resultHash": PatchRecipe.hash(target),
    "resultSize": target.count, "operations": [["offset":0,"length":4],
        ["add":Data([11,0,0,0]).base64EncodedString()], ["offset":8,"length":2],
        ["add":Data([3]).base64EncodedString()]]]
let recipe = try JSONDecoder().decode(PatchRecipe.self, from: JSONSerialization.data(withJSONObject: value))
let result = try recipe.apply(source)
assert(result == target)
let repeated = try recipe.apply(target)
assert(repeated == target)
for invalid in [Data(), Data([70,87,83]), Data([70,87,83,17,255,255,255,255])] {
    var rejected = false
    do { _ = try recipe.apply(invalid) } catch { rejected = true }
    assert(rejected)
}
var bad = value
bad["operations"] = [["offset":100,"length":4]]
let bounds = try JSONDecoder().decode(PatchRecipe.self, from: JSONSerialization.data(withJSONObject: bad))
var rejected = false
do { _ = try bounds.apply(source) } catch { rejected = true }
assert(rejected)
print("PASS: generated local fixture, idempotence, version/header/size validation and copy bounds")

// Minimal self-authored SWF: RECT, frame timing, DefineBinaryData(3), End.
func wrapper(_ inner: Data, duplicate: Bool = false) -> Data {
    var payload = Data([8,0,0,12,1,0])
    let binary = Data([255,21]) + Data((0..<4).map { UInt8(((inner.count + 6) >> (8 * $0)) & 255) })
        + Data([3,0,0,0,0,0]) + inner
    payload.append(binary)
    if duplicate { payload.append(binary) }
    payload.append(Data([0,0]))
    return Data([70,87,83,17]) + Data((0..<4).map { UInt8(((payload.count + 8) >> (8 * $0)) & 255) }) + payload
}
let outer = wrapper(source), outerTarget = wrapper(target)
var embedded = value
embedded["binaryID"] = 3
let nestedValue: [String: Any] = ["sourceHash":PatchRecipe.hash(outer), "resultHash":PatchRecipe.hash(outerTarget),
    "resultSize":outerTarget.count, "operations":[], "embedded":embedded]
func decode(_ value: [String: Any]) throws -> PatchRecipe {
    try JSONDecoder().decode(PatchRecipe.self, from: JSONSerialization.data(withJSONObject: value))
}
let nested = try decode(nestedValue)
let nestedResult = try nested.apply(outer)
assert(nestedResult == outerTarget)
let nestedRepeated = try nested.apply(outerTarget)
assert(nestedRepeated == outerTarget)
var wrongID = nestedValue, wrongHash = nestedValue, mixed = nestedValue, wrongSize = nestedValue
var child = embedded
child["binaryID"] = 7; wrongID["embedded"] = child
child = embedded; child["sourceHash"] = "wrong-version"; wrongHash["embedded"] = child
mixed["operations"] = [["offset":0,"length":8]]
wrongSize["resultSize"] = outerTarget.count + 1
for invalidRecipe in [wrongID, wrongHash, mixed, wrongSize] {
    var rejected = false
    do { _ = try decode(invalidRecipe).apply(outer) } catch { rejected = true }
    assert(rejected)
}
var malformed = outer
malformed.replaceSubrange(16..<20, with: Data([255,255,255,255]))
let duplicate = wrapper(source, duplicate: true)
for invalidSource in [malformed, duplicate] {
    var invalidRecipe = nestedValue
    invalidRecipe["sourceHash"] = PatchRecipe.hash(invalidSource)
    var rejected = false
    do { _ = try decode(invalidRecipe).apply(invalidSource) } catch { rejected = true }
    assert(rejected)
}
print("PASS: nested SWF fixture, idempotence, binary identity/hash/size checks and malformed/duplicate tag rejection")
