#include "PatchDecoder.h"
#include <stdint.h>
/* Public liblzma ABI declarations. Decoder implementation is supplied by macOS. */
typedef struct { uint64_t id; void *options; } ZmxyLzmaFilter;
extern int lzma_properties_decode(ZmxyLzmaFilter *, const void *, const uint8_t *, size_t);
extern int lzma_raw_buffer_decode(const ZmxyLzmaFilter *, const void *, const uint8_t *,
                                  size_t *, size_t, uint8_t *, size_t *, size_t);
extern void lzma_filters_free(ZmxyLzmaFilter *, const void *);
int zmxy_decode_lzma(const unsigned char *properties, const unsigned char *input,
                     size_t input_size, unsigned char *output, size_t output_size) {
    uint32_t dictionary = (uint32_t)properties[1] | (uint32_t)properties[2] << 8 |
                          (uint32_t)properties[3] << 16 | (uint32_t)properties[4] << 24;
    if (dictionary > 32 * 1024 * 1024) return -1;
    ZmxyLzmaFilter filters[2] = {{UINT64_C(0x4000000000000001), NULL}, {UINT64_MAX, NULL}};
    int result = lzma_properties_decode(filters, NULL, properties, 5);
    if (result == 0) {
        size_t in_position = 0, out_position = 0;
        result = lzma_raw_buffer_decode(filters, NULL, input, &in_position, input_size,
                                        output, &out_position, output_size);
        if (out_position != output_size) result = -1;
    }
    lzma_filters_free(filters, NULL);
    return result;
}
